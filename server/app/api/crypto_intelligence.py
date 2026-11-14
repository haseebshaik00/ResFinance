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
from server.app.domain.phase2_portfolio import (
    CashReserve,
    ForecastAccuracy,
    Phase2Allocation,
    Phase2Recommendation,
    SevenDayAssetForecast,
    SevenDayForecast,
)


class MoneyModel(BaseModel):
    model_config = ConfigDict(extra="forbid")
    currency: Literal["USD"] = "USD"
    minor_units: int


class RecommendationCommand(BaseModel):
    model_config = ConfigDict(extra="forbid")
    capital: MoneyModel


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
    policy_version: Literal["phase2-model-informed-diversified-cash-v3"]
    model_confidence: str
    diversification_prior: Literal["inverse-volatility"]
    allocations: list[AllocationModel]
    cash_reserve: CashReserveModel
    crypto_allocation_weight: str
    total_allocation_weight: str
    warnings: list[str]


def create_crypto_intelligence_router(
    service: Phase2PortfolioService | None,
    auth_service: AuthenticationService | None,
) -> APIRouter:
    router = APIRouter(prefix="/crypto", tags=["crypto"])

    def services() -> tuple[Phase2PortfolioService, AuthenticationService]:
        if service is None or auth_service is None:
            raise HTTPException(
                status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
                detail="Phase 2 crypto intelligence is not configured",
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

    @router.post("/recommendations", response_model=RecommendationModel)
    def recommendation(
        request: RecommendationCommand,
        authorization: Annotated[str | None, Header(alias="Authorization")] = None,
        origin: Annotated[str | None, Header(alias="Origin")] = None,
        referer: Annotated[str | None, Header(alias="Referer")] = None,
    ) -> RecommendationModel:
        portfolio, _ = services()
        principal(authorization, origin, referer)
        try:
            return _recommendation_response(
                portfolio.recommend(capital_minor_units=request.capital.minor_units)
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
        model_confidence=value.model_confidence,
        diversification_prior=value.diversification_prior,
        allocations=[_allocation_response(item) for item in value.allocations],
        cash_reserve=_cash_reserve_response(value.cash_reserve),
        crypto_allocation_weight=str(sum(Decimal(item.weight) for item in value.allocations)),
        total_allocation_weight=str(
            sum(Decimal(item.weight) for item in value.allocations)
            + Decimal(value.cash_reserve.weight)
        ),
        warnings=list(value.warnings),
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
