from __future__ import annotations

from datetime import datetime
from typing import Annotated, Literal, NoReturn
from urllib.parse import urlsplit

from fastapi import APIRouter, Header, HTTPException, status
from pydantic import BaseModel, ConfigDict, Field

from server.app.application.authentication import (
    AccessPrincipal,
    AuthenticationService,
    AuthRejected,
    OriginRejected,
    SessionUnauthorized,
)
from server.app.application.portfolio import CryptoOverview, PortfolioRejected, PortfolioService
from server.app.domain.events import AppendResult
from server.app.domain.portfolio import (
    Allocation,
    AssetForecast,
    ForecastSnapshot,
    PortfolioRecommendation,
    PricePoint,
    RiskAnswers,
    RiskProfile,
)
from server.app.infrastructure.event_repository import AggregateVersionConflict, IdempotencyConflict


class MoneyModel(BaseModel):
    model_config = ConfigDict(extra="forbid")
    currency: Literal["USD"] = "USD"
    minor_units: int


class RiskAnswersModel(BaseModel):
    model_config = ConfigDict(extra="forbid")
    investment_horizon: int = Field(ge=1, le=3)
    risk_tolerance: int = Field(ge=1, le=3)
    liquidity_needs: int = Field(ge=1, le=3)


class RiskProfileCommand(BaseModel):
    model_config = ConfigDict(extra="forbid")
    answers: RiskAnswersModel
    expected_version: int = Field(ge=0)


class ScenarioCommand(BaseModel):
    model_config = ConfigDict(extra="forbid")
    amount: MoneyModel


class RiskProfileEventResponse(BaseModel):
    event_id: str
    projection_version: int
    occurred_at_utc: datetime
    deduplicated: bool


class RiskProfileModel(BaseModel):
    answers: RiskAnswersModel
    score: int
    policy_version: Literal["risk-questionnaire-v2"]
    source_event_id: str
    recorded_at_utc: datetime


class PricePointModel(BaseModel):
    asset: Literal["BTC", "ETH", "SOL"]
    observed_at_utc: datetime
    price_usd: str
    source_record_id: str


class AssetForecastModel(BaseModel):
    asset: Literal["BTC", "ETH", "SOL"]
    expected_return: str
    probability_up: str
    p10_return: str
    p50_return: str
    p90_return: str


class ForecastSnapshotModel(BaseModel):
    snapshot_id: str
    as_of_utc: datetime
    expires_at_utc: datetime
    horizon_days: Literal[15]
    run_id: str
    model_name: Literal["adaptive-gating"]
    model_hash: str
    dataset_hash: str
    promotion_event_id: str
    scope: str
    forecasts: list[AssetForecastModel]
    price_history: list[PricePointModel]


class AllocationModel(BaseModel):
    asset: Literal["BTC", "ETH", "SOL"]
    weight: str
    amount: MoneyModel
    cap: str


class RecommendationModel(BaseModel):
    capital: MoneyModel
    source_kind: Literal["finance_savings", "scenario"]
    savings_calculation_id: str | None
    savings_source_event_ids: list[str]
    risk_score: int
    risk_profile_event_id: str
    policy_version: Literal["portfolio-policy-v1"]
    forecast_snapshot_id: str
    promotion_event_id: str
    solver: str
    fallback_used: bool
    covariance_repaired: bool
    allocations: list[AllocationModel]
    warnings: list[str]


class CryptoOverviewModel(BaseModel):
    month: str
    risk_profile: RiskProfileModel | None
    risk_projection_version: int
    forecast: ForecastSnapshotModel | None
    recommendation: RecommendationModel | None
    default_capital: MoneyModel
    savings_formula_version: Literal["finance-savings-v1"]
    savings_calculation_id: str
    savings_source_event_ids: list[str]


def create_portfolio_router(
    service: PortfolioService | None,
    auth_service: AuthenticationService | None,
) -> APIRouter:
    router = APIRouter(prefix="/crypto", tags=["crypto"])

    def services() -> tuple[PortfolioService, AuthenticationService]:
        if service is None or auth_service is None:
            raise HTTPException(
                status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
                detail="portfolio persistence is not configured",
            )
        return service, auth_service

    def principal(
        authorization: Annotated[str | None, Header(alias="Authorization")] = None,
        origin: Annotated[str | None, Header(alias="Origin")] = None,
        referer: Annotated[str | None, Header(alias="Referer")] = None,
    ) -> AccessPrincipal:
        _, authentication = services()
        prefix = "Bearer "
        if authorization is None or not authorization.startswith(prefix):
            raise HTTPException(status_code=401, detail="bearer token is required")
        request_origin = origin or _origin_from_referer(referer)
        if request_origin is None:
            raise HTTPException(
                status_code=403,
                detail="request origin or same-origin referrer is required",
            )
        try:
            return authentication.authenticate_access_token(
                access_token=authorization[len(prefix) :], origin=request_origin
            )
        except AuthRejected as exc:
            _raise_auth_error(exc)

    @router.get("/overview", response_model=CryptoOverviewModel)
    def overview(
        month: str,
        authorization: Annotated[str | None, Header(alias="Authorization")] = None,
        origin: Annotated[str | None, Header(alias="Origin")] = None,
        referer: Annotated[str | None, Header(alias="Referer")] = None,
    ) -> CryptoOverviewModel:
        portfolio, _ = services()
        actor = principal(authorization, origin, referer)
        try:
            result = portfolio.overview(actor_address=actor.actor_address, month=month)
            return _overview_response(result)
        except PortfolioRejected as exc:
            raise HTTPException(status_code=422, detail=str(exc)) from exc

    @router.post("/risk-profile", response_model=RiskProfileEventResponse, status_code=201)
    def record_risk_profile(
        request: RiskProfileCommand,
        idempotency_key: Annotated[str, Header(alias="Idempotency-Key")],
        authorization: Annotated[str | None, Header(alias="Authorization")] = None,
        origin: Annotated[str | None, Header(alias="Origin")] = None,
    ) -> RiskProfileEventResponse:
        portfolio, _ = services()
        actor = principal(authorization, origin)
        try:
            result = portfolio.record_risk_profile(
                actor_address=actor.actor_address,
                idempotency_key=idempotency_key,
                expected_version=request.expected_version,
                answers=RiskAnswers(**request.answers.model_dump()),
            )
        except (PortfolioRejected, AggregateVersionConflict, IdempotencyConflict) as exc:
            code = 409 if isinstance(exc, AggregateVersionConflict | IdempotencyConflict) else 422
            raise HTTPException(status_code=code, detail=str(exc)) from exc
        return _event_response(result)

    @router.post("/scenarios", response_model=RecommendationModel)
    def analyze_scenario(
        request: ScenarioCommand,
        authorization: Annotated[str | None, Header(alias="Authorization")] = None,
        origin: Annotated[str | None, Header(alias="Origin")] = None,
    ) -> RecommendationModel:
        portfolio, _ = services()
        actor = principal(authorization, origin)
        try:
            result = portfolio.analyze_scenario(
                actor_address=actor.actor_address,
                amount_minor_units=request.amount.minor_units,
            )
        except PortfolioRejected as exc:
            raise HTTPException(status_code=422, detail=str(exc)) from exc
        return _recommendation_response(result)

    return router


def _overview_response(value: CryptoOverview) -> CryptoOverviewModel:
    return CryptoOverviewModel(
        month=value.month,
        risk_profile=_risk_response(value.risk_profile) if value.risk_profile else None,
        risk_projection_version=value.risk_projection_version,
        forecast=_forecast_response(value.forecast) if value.forecast else None,
        recommendation=(
            _recommendation_response(value.recommendation) if value.recommendation else None
        ),
        default_capital=MoneyModel(minor_units=value.available_savings_minor_units),
        savings_formula_version="finance-savings-v1",
        savings_calculation_id=value.savings_calculation_id,
        savings_source_event_ids=list(value.savings_source_event_ids),
    )


def _risk_response(value: RiskProfile) -> RiskProfileModel:
    return RiskProfileModel(
        answers=RiskAnswersModel(**value.answers.to_dict()),
        score=value.score,
        policy_version="risk-questionnaire-v2",
        source_event_id=value.source_event_id,
        recorded_at_utc=value.recorded_at_utc,
    )


def _forecast_response(value: ForecastSnapshot) -> ForecastSnapshotModel:
    return ForecastSnapshotModel(
        snapshot_id=value.snapshot_id,
        as_of_utc=value.as_of_utc,
        expires_at_utc=value.expires_at_utc,
        horizon_days=15,
        run_id=value.run_id,
        model_name="adaptive-gating",
        model_hash=value.model_hash,
        dataset_hash=value.dataset_hash,
        promotion_event_id=value.promotion_event_id,
        scope=value.scope,
        forecasts=[_asset_forecast_response(item) for item in value.forecasts],
        price_history=[_price_response(item) for item in value.price_history],
    )


def _asset_forecast_response(value: AssetForecast) -> AssetForecastModel:
    return AssetForecastModel(**{**value.__dict__, "asset": value.asset.value})


def _price_response(value: PricePoint) -> PricePointModel:
    return PricePointModel(**{**value.__dict__, "asset": value.asset.value})


def _recommendation_response(value: PortfolioRecommendation) -> RecommendationModel:
    return RecommendationModel(
        capital=MoneyModel(minor_units=value.capital_minor_units),
        source_kind=value.source_kind,
        savings_calculation_id=value.savings_calculation_id,
        savings_source_event_ids=list(value.savings_source_event_ids),
        risk_score=value.risk_score,
        risk_profile_event_id=value.risk_profile_event_id,
        policy_version="portfolio-policy-v1",
        forecast_snapshot_id=value.forecast_snapshot_id,
        promotion_event_id=value.promotion_event_id,
        solver=value.solver,
        fallback_used=value.fallback_used,
        covariance_repaired=value.covariance_repaired,
        allocations=[_allocation_response(item) for item in value.allocations],
        warnings=list(value.warnings),
    )


def _allocation_response(value: Allocation) -> AllocationModel:
    return AllocationModel(
        asset=value.asset.value,
        weight=value.weight,
        amount=MoneyModel(minor_units=value.amount_minor_units),
        cap=value.cap,
    )


def _event_response(result: AppendResult) -> RiskProfileEventResponse:
    return RiskProfileEventResponse(
        event_id=result.event.event_id,
        projection_version=result.event.aggregate_version,
        occurred_at_utc=result.event.occurred_at_utc,
        deduplicated=result.deduplicated,
    )


def _origin_from_referer(referer: str | None) -> str | None:
    if referer is None:
        return None
    parsed = urlsplit(referer)
    return f"{parsed.scheme}://{parsed.netloc}" if parsed.scheme and parsed.netloc else None


def _raise_auth_error(exc: AuthRejected) -> NoReturn:
    code = 403 if isinstance(exc, OriginRejected) else 401
    if isinstance(exc, SessionUnauthorized):
        code = 401
    raise HTTPException(status_code=code, detail=str(exc)) from exc
