from __future__ import annotations

from datetime import date, datetime
from decimal import Decimal
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
from server.app.application.phase2_portfolio import (
    Phase2PortfolioRejected,
    Phase2PortfolioService,
)
from server.app.application.portfolio import PortfolioService
from server.app.domain.events import AppendResult
from server.app.domain.phase2_portfolio import (
    CashReserve,
    ForecastAccuracy,
    Phase2Allocation,
    Phase2Recommendation,
    SevenDayAssetForecast,
    SevenDayForecast,
)
from server.app.domain.portfolio import RiskAnswers, RiskProfile, RiskProjection
from server.app.infrastructure.event_repository import AggregateVersionConflict, IdempotencyConflict


class MoneyModel(BaseModel):
    model_config = ConfigDict(extra="forbid")
    currency: Literal["USD"] = "USD"
    minor_units: int


class RecommendationCommand(BaseModel):
    model_config = ConfigDict(extra="forbid")
    capital: MoneyModel


class RiskAnswersModel(BaseModel):
    model_config = ConfigDict(extra="forbid")
    investment_horizon: int = Field(ge=1, le=3)
    risk_tolerance: int = Field(ge=1, le=3)
    liquidity_needs: int = Field(ge=1, le=3)


class RiskProfileCommand(BaseModel):
    model_config = ConfigDict(extra="forbid")
    answers: RiskAnswersModel
    expected_version: int = Field(ge=0)


class RiskProfileEventModel(BaseModel):
    event_id: str
    projection_version: int
    occurred_at_utc: datetime
    deduplicated: bool


class RiskProfileModel(BaseModel):
    answers: RiskAnswersModel
    score: int
    policy_version: Literal["risk-questionnaire-v3"]
    source_event_id: str
    recorded_at_utc: datetime


class RiskProfileOverviewModel(BaseModel):
    projection_version: int
    profile: RiskProfileModel | None


class AssetForecastModel(BaseModel):
    asset: Literal["BTC", "ETH", "SOL"]
    current_price: str
    predicted_prices: list[str]
    predicted_daily_returns: list[str]
    predicted_return_7d: str


class ForecastAccuracyModel(BaseModel):
    model_key: Literal["original-mspciformer", "vasa-mspciformer"]
    mape: str
    return_7d_mae: str
    directional_accuracy: str
    btc_day_7_mae_usd: str
    eth_day_7_mae_usd: str
    sol_day_7_mae_usd: str


class SevenDayForecastModel(BaseModel):
    snapshot_id: str
    run_id: str
    manifest_key: str
    model_key: Literal["original-mspciformer", "vasa-mspciformer"]
    model_name: str
    model_version: str
    generated_at_utc: datetime
    market_data_cutoff_utc: datetime
    forecast_dates_utc: list[date] = Field(min_length=7, max_length=7)
    assets: list[AssetForecastModel] = Field(min_length=3, max_length=3)
    status: Literal["current", "stale"]
    stale_reasons: list[str]
    refreshed_from_checkpoint: bool
    quality_checks: dict[str, object]
    accuracy: list[ForecastAccuracyModel]
    research_status: Literal["experimental"] = "experimental"


class AllocationModel(BaseModel):
    asset: Literal["BTC", "ETH", "SOL"]
    weight: str
    amount: MoneyModel


class CashReserveModel(BaseModel):
    label: Literal["USD cash reserve"] = "USD cash reserve"
    weight: str
    amount: MoneyModel


class ExpectedReturnModel(BaseModel):
    asset: Literal["BTC", "ETH", "SOL"]
    predicted_return_7d: str


class RecommendationModel(BaseModel):
    capital: MoneyModel
    forecast_snapshot_id: str
    forecast_status: Literal["current", "stale"]
    model_key: str
    model_version: str
    expected_returns_7d: list[ExpectedReturnModel]
    predicted_portfolio_return_7d: str
    estimated_portfolio_volatility_7d: str
    risk_aversion: str
    covariance_lookback_days: int
    covariance_estimator: Literal["Ledoit-Wolf"]
    covariance_repaired: bool
    solver: str
    solver_status: str
    policy_version: Literal["phase2-risk-profile-model-blend-v4"]
    risk_profile: Literal["conservative", "balanced", "growth"]
    risk_score: int
    risk_profile_event_id: str
    risk_policy_version: Literal["risk-questionnaire-v3"]
    model_confidence: str
    model_blend: Literal["confidence-weighted"]
    strategic_allocations: list[AllocationModel]
    strategic_cash_reserve: CashReserveModel
    tactical_adjustments: list[TacticalAdjustmentModel]
    allocations: list[AllocationModel]
    cash_reserve: CashReserveModel
    crypto_allocation_weight: str
    total_allocation_weight: str
    warnings: list[str]


class TacticalAdjustmentModel(BaseModel):
    asset: Literal["BTC", "ETH", "SOL"]
    weight: str


def create_crypto_intelligence_router(
    service: Phase2PortfolioService | None,
    auth_service: AuthenticationService | None,
    risk_profiles: PortfolioService | None,
) -> APIRouter:
    router = APIRouter(prefix="/crypto", tags=["crypto"])

    def services() -> tuple[Phase2PortfolioService, AuthenticationService]:
        if service is None or auth_service is None:
            raise HTTPException(
                status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
                detail="Phase 2 crypto intelligence is not configured",
            )
        return service, auth_service

    def risk_service() -> PortfolioService:
        if risk_profiles is None:
            raise HTTPException(
                status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
                detail="risk profile storage is not configured",
            )
        return risk_profiles

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

    @router.get("/forecast", response_model=SevenDayForecastModel)
    def forecast(
        authorization: Annotated[str | None, Header(alias="Authorization")] = None,
        origin: Annotated[str | None, Header(alias="Origin")] = None,
        referer: Annotated[str | None, Header(alias="Referer")] = None,
    ) -> SevenDayForecastModel:
        portfolio, _ = services()
        principal(authorization, origin, referer)
        try:
            return _forecast_response(portfolio.forecast())
        except Phase2PortfolioRejected as exc:
            raise HTTPException(status_code=503, detail=str(exc)) from exc

    @router.get("/risk-profile", response_model=RiskProfileOverviewModel)
    def risk_profile(
        authorization: Annotated[str | None, Header(alias="Authorization")] = None,
        origin: Annotated[str | None, Header(alias="Origin")] = None,
        referer: Annotated[str | None, Header(alias="Referer")] = None,
    ) -> RiskProfileOverviewModel:
        actor = principal(authorization, origin, referer)
        projection = risk_service().risk_profile(actor_address=actor.actor_address)
        return _risk_profile_overview(projection)

    @router.post("/risk-profile", response_model=RiskProfileEventModel, status_code=201)
    def record_risk_profile(
        request: RiskProfileCommand,
        idempotency_key: Annotated[str, Header(alias="Idempotency-Key")],
        authorization: Annotated[str | None, Header(alias="Authorization")] = None,
        origin: Annotated[str | None, Header(alias="Origin")] = None,
    ) -> RiskProfileEventModel:
        actor = principal(authorization, origin)
        try:
            result = risk_service().record_risk_profile(
                actor_address=actor.actor_address,
                idempotency_key=idempotency_key,
                expected_version=request.expected_version,
                answers=RiskAnswers(**request.answers.model_dump()),
            )
        except (ValueError, AggregateVersionConflict, IdempotencyConflict) as exc:
            code = 409 if isinstance(exc, AggregateVersionConflict | IdempotencyConflict) else 422
            raise HTTPException(status_code=code, detail=str(exc)) from exc
        return _risk_profile_event(result)

    @router.post("/recommendations", response_model=RecommendationModel)
    def recommendation(
        request: RecommendationCommand,
        authorization: Annotated[str | None, Header(alias="Authorization")] = None,
        origin: Annotated[str | None, Header(alias="Origin")] = None,
        referer: Annotated[str | None, Header(alias="Referer")] = None,
    ) -> RecommendationModel:
        portfolio, _ = services()
        actor = principal(authorization, origin, referer)
        try:
            profile = risk_service().risk_profile(actor_address=actor.actor_address).profile
            if profile is None:
                raise Phase2PortfolioRejected("complete the risk questionnaire first")
            return _recommendation_response(
                portfolio.recommend(
                    capital_minor_units=request.capital.minor_units,
                    risk_profile=profile,
                )
            )
        except Phase2PortfolioRejected as exc:
            raise HTTPException(status_code=422, detail=str(exc)) from exc

    return router


def _forecast_response(value: SevenDayForecast) -> SevenDayForecastModel:
    return SevenDayForecastModel(
        snapshot_id=value.snapshot_id,
        run_id=value.run_id,
        manifest_key=value.manifest_key,
        model_key=value.model_key,
        model_name=value.model_name,
        model_version=value.model_version,
        generated_at_utc=value.generated_at_utc,
        market_data_cutoff_utc=value.market_data_cutoff_utc,
        forecast_dates_utc=list(value.forecast_dates_utc),
        assets=[_asset_response(item) for item in value.assets],
        status=value.status,
        stale_reasons=list(value.stale_reasons),
        refreshed_from_checkpoint=value.refreshed_from_checkpoint,
        quality_checks=value.quality_checks,
        accuracy=[_accuracy_response(item) for item in value.accuracy],
    )


def _asset_response(value: SevenDayAssetForecast) -> AssetForecastModel:
    return AssetForecastModel(
        asset=value.asset.value,
        current_price=value.current_price,
        predicted_prices=list(value.predicted_prices),
        predicted_daily_returns=list(value.predicted_daily_returns),
        predicted_return_7d=value.predicted_return_7d,
    )


def _accuracy_response(value: ForecastAccuracy) -> ForecastAccuracyModel:
    return ForecastAccuracyModel(**value.__dict__)


def _recommendation_response(value: Phase2Recommendation) -> RecommendationModel:
    return RecommendationModel(
        capital=MoneyModel(minor_units=value.capital_minor_units),
        forecast_snapshot_id=value.forecast_snapshot_id,
        forecast_status=value.forecast_status,
        model_key=value.model_key,
        model_version=value.model_version,
        expected_returns_7d=[
            ExpectedReturnModel(asset=asset.value, predicted_return_7d=expected)
            for asset, expected in value.expected_returns_7d
        ],
        predicted_portfolio_return_7d=value.predicted_portfolio_return_7d,
        estimated_portfolio_volatility_7d=value.estimated_portfolio_volatility_7d,
        risk_aversion=value.risk_aversion,
        covariance_lookback_days=value.covariance_lookback_days,
        covariance_estimator=value.covariance_estimator,
        covariance_repaired=value.covariance_repaired,
        solver=value.solver,
        solver_status=value.solver_status,
        policy_version=value.policy_version,
        risk_profile=value.risk_profile,
        risk_score=value.risk_score,
        risk_profile_event_id=value.risk_profile_event_id,
        risk_policy_version=value.risk_policy_version,
        model_confidence=value.model_confidence,
        model_blend=value.model_blend,
        strategic_allocations=[_allocation_response(item) for item in value.strategic_allocations],
        strategic_cash_reserve=_cash_reserve_response(value.strategic_cash_reserve),
        tactical_adjustments=[
            TacticalAdjustmentModel(asset=item.asset.value, weight=item.weight)
            for item in value.tactical_adjustments
        ],
        allocations=[_allocation_response(item) for item in value.allocations],
        cash_reserve=_cash_reserve_response(value.cash_reserve),
        crypto_allocation_weight=str(sum(Decimal(item.weight) for item in value.allocations)),
        total_allocation_weight=str(
            sum(Decimal(item.weight) for item in value.allocations)
            + Decimal(value.cash_reserve.weight)
        ),
        warnings=list(value.warnings),
    )


def _risk_profile_overview(value: RiskProjection) -> RiskProfileOverviewModel:
    return RiskProfileOverviewModel(
        projection_version=value.projection_version,
        profile=_risk_profile_response(value.profile) if value.profile else None,
    )


def _risk_profile_response(value: RiskProfile) -> RiskProfileModel:
    return RiskProfileModel(
        answers=RiskAnswersModel(**value.answers.to_dict()),
        score=value.score,
        policy_version="risk-questionnaire-v3",
        source_event_id=value.source_event_id,
        recorded_at_utc=value.recorded_at_utc,
    )


def _risk_profile_event(value: AppendResult) -> RiskProfileEventModel:
    return RiskProfileEventModel(
        event_id=value.event.event_id,
        projection_version=value.event.aggregate_version,
        occurred_at_utc=value.event.occurred_at_utc,
        deduplicated=value.deduplicated,
    )


def _allocation_response(value: Phase2Allocation) -> AllocationModel:
    return AllocationModel(
        asset=value.asset.value,
        weight=value.weight,
        amount=MoneyModel(minor_units=value.amount_minor_units),
    )


def _cash_reserve_response(value: CashReserve) -> CashReserveModel:
    return CashReserveModel(
        weight=value.weight,
        amount=MoneyModel(minor_units=value.amount_minor_units),
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
