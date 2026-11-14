# mypy: disable-error-code="import-untyped,attr-defined,no-untyped-call,no-any-return"

from __future__ import annotations

from dataclasses import dataclass
from decimal import ROUND_FLOOR, Decimal

import cvxpy as cp
import numpy as np
from sklearn.covariance import LedoitWolf

from server.app.domain.crypto import CryptoAsset
from server.app.domain.phase2_portfolio import CashReserve, HistoricalPrice, Phase2Allocation

ASSETS: tuple[CryptoAsset, ...] = tuple(CryptoAsset)


@dataclass(frozen=True)
class Phase2OptimizationResult:
    allocations: tuple[Phase2Allocation, ...]
    cash_reserve: CashReserve
    predicted_return_7d: str
    estimated_volatility_7d: str
    solver: str
    solver_status: str
    covariance_repaired: bool
    covariance_observation_count: int


def optimize_seven_day_portfolio(
    *,
    capital_minor_units: int,
    expected_returns: dict[CryptoAsset, Decimal],
    price_history: tuple[HistoricalPrice, ...],
    risk_aversion: Decimal,
    covariance_lookback_days: int,
    model_confidence: Decimal = Decimal(0),
) -> Phase2OptimizationResult:
    if isinstance(capital_minor_units, bool) or capital_minor_units <= 0:
        raise ValueError("investment capital must be positive integer USD cents")
    if set(expected_returns) != set(ASSETS):
        raise ValueError("expected returns must contain exactly BTC, ETH, and SOL")
    if not risk_aversion.is_finite() or risk_aversion <= 0:
        raise ValueError("risk aversion must be positive")
    if covariance_lookback_days < 30:
        raise ValueError("covariance lookback must be at least 30 days")
    if not model_confidence.is_finite() or not Decimal(0) <= model_confidence <= Decimal(1):
        raise ValueError("model confidence must be between zero and one")

    daily_returns = _aligned_daily_returns(price_history, covariance_lookback_days)
    covariance = LedoitWolf().fit(daily_returns).covariance_ * 7.0
    covariance, repaired = _nearest_psd(covariance)
    expected = np.asarray([float(expected_returns[asset]) for asset in ASSETS], dtype=np.float64)
    if not np.isfinite(expected).all():
        raise ValueError("expected returns must be finite")

    weights = cp.Variable(len(ASSETS))
    objective = cp.Maximize(
        expected @ weights - float(risk_aversion) * cp.quad_form(weights, covariance)
    )
    # Cash is the residual USD amount. It has a zero seven-day return and no
    # crypto covariance, so it need not be added to the covariance matrix.
    # The inequality deliberately permits a partial crypto allocation.
    problem = cp.Problem(objective, [weights >= 0, cp.sum(weights) <= 1])
    failures: list[str] = []
    solver = ""
    for candidate in ("CLARABEL", "SCS"):
        try:
            problem.solve(solver=candidate)
        except cp.SolverError as exc:
            failures.append(f"{candidate}: {exc}")
            continue
        if problem.status in {cp.OPTIMAL, cp.OPTIMAL_INACCURATE} and weights.value is not None:
            solver = candidate
            break
        failures.append(f"{candidate}: status {problem.status}")
    if not solver or weights.value is None:
        raise ValueError("portfolio optimization failed: " + "; ".join(failures))

    optimized_crypto_weights = _validate_crypto_weights(np.asarray(weights.value, dtype=np.float64))
    crypto_weights = _diversify_crypto_sleeve(
        optimized_crypto_weights,
        covariance,
        float(model_confidence),
    )
    all_weights = np.append(crypto_weights, max(0.0, 1.0 - float(crypto_weights.sum())))
    amounts = _reconcile_cents(capital_minor_units, all_weights)
    weight_strings = _reconciled_weight_strings(all_weights)
    allocations = tuple(
        Phase2Allocation(
            asset=asset,
            weight=weight_strings[index],
            amount_minor_units=amounts[index],
        )
        for index, asset in enumerate(ASSETS)
    )
    cash_reserve = CashReserve(weight=weight_strings[-1], amount_minor_units=amounts[-1])
    portfolio_return = float(expected @ crypto_weights)
    portfolio_variance = float(crypto_weights @ covariance @ crypto_weights)
    if portfolio_variance < -1e-12:
        raise ValueError("optimized covariance produced negative portfolio variance")
    return Phase2OptimizationResult(
        allocations=allocations,
        cash_reserve=cash_reserve,
        predicted_return_7d=_decimal(portfolio_return, 10),
        estimated_volatility_7d=_decimal(float(np.sqrt(max(portfolio_variance, 0.0))), 10),
        solver=solver,
        solver_status=str(problem.status),
        covariance_repaired=repaired,
        covariance_observation_count=len(daily_returns),
    )


def _aligned_daily_returns(history: tuple[HistoricalPrice, ...], lookback_days: int) -> np.ndarray:
    prices: dict[CryptoAsset, dict[str, Decimal]] = {asset: {} for asset in ASSETS}
    for point in history:
        prices[point.asset][point.observed_date_utc.isoformat()] = Decimal(point.price_usd)
    common_days = sorted(set.intersection(*(set(values) for values in prices.values())))
    required_prices = lookback_days + 1
    if len(common_days) < required_prices:
        raise ValueError(
            f"at least {required_prices} aligned price days are required for covariance"
        )
    common_days = common_days[-required_prices:]
    rows = [
        [float(prices[asset][current] / prices[asset][previous] - Decimal(1)) for asset in ASSETS]
        for previous, current in zip(common_days, common_days[1:], strict=False)
    ]
    result = np.asarray(rows, dtype=np.float64)
    if result.shape != (lookback_days, len(ASSETS)) or not np.isfinite(result).all():
        raise ValueError("aligned covariance inputs are invalid")
    return result


def _nearest_psd(matrix: np.ndarray) -> tuple[np.ndarray, bool]:
    symmetric = (matrix + matrix.T) / 2.0
    values, vectors = np.linalg.eigh(symmetric)
    repaired = bool(np.any(values < 1e-10))
    clipped = np.maximum(values, 1e-10)
    return vectors @ np.diag(clipped) @ vectors.T, repaired


def _validate_crypto_weights(values: np.ndarray) -> np.ndarray:
    if values.shape != (len(ASSETS),) or not np.isfinite(values).all():
        raise ValueError("solver returned invalid portfolio weights")
    result = np.maximum(values, 0.0)
    # Both supported conic solvers can return sub-nanoscopic positive values
    # for an optimum at zero. They are neither economically meaningful nor
    # representable as USD cents.
    result[result < 5e-9] = 0.0
    total = float(result.sum())
    if np.any(result < -1e-10) or total > 1.0 + 1e-8:
        raise ValueError("portfolio weights are infeasible")
    if total > 1.0:
        result /= total
    return result


def _diversify_crypto_sleeve(
    optimized_weights: np.ndarray,
    covariance: np.ndarray,
    model_confidence: float,
) -> np.ndarray:
    """Keep model-selected sleeve exposure, then diversify its BTC/ETH/SOL mix."""

    sleeve_weight = float(optimized_weights.sum())
    if sleeve_weight <= 0:
        return optimized_weights
    diagonal = np.diag(covariance)
    if (
        diagonal.shape != (len(ASSETS),)
        or not np.isfinite(diagonal).all()
        or np.any(diagonal <= 0)
    ):
        raise ValueError("covariance diagonal is invalid for inverse-volatility diversification")
    model_mix = optimized_weights / sleeve_weight
    inverse_volatility = 1.0 / np.sqrt(diagonal)
    prior_mix = inverse_volatility / inverse_volatility.sum()
    diversified = sleeve_weight * (
        model_confidence * model_mix + (1.0 - model_confidence) * prior_mix
    )
    return _validate_crypto_weights(diversified)


def _reconcile_cents(capital: int, weights: np.ndarray) -> tuple[int, ...]:
    exact = [Decimal(capital) * Decimal(str(float(weight))) for weight in weights]
    amounts = [int(value.to_integral_value(rounding=ROUND_FLOOR)) for value in exact]
    remainder = capital - sum(amounts)
    order = sorted(range(len(exact)), key=lambda index: exact[index] - amounts[index], reverse=True)
    for index in order[:remainder]:
        amounts[index] += 1
    if sum(amounts) != capital:
        raise ValueError("allocation amounts do not reconcile to capital")
    return tuple(amounts)


def _decimal(value: float, places: int) -> str:
    return format(Decimal(str(value)).quantize(Decimal(1).scaleb(-places)), "f")


def _reconciled_weight_strings(weights: np.ndarray) -> tuple[str, ...]:
    """Round crypto weights, then assign the exact residual to USD cash."""

    if weights.shape != (len(ASSETS) + 1,) or not np.isfinite(weights).all():
        raise ValueError("allocation weights are invalid")
    quantum = Decimal("0.0000000001")
    rounded = [Decimal(str(float(value))).quantize(quantum) for value in weights[:-1]]
    final = (Decimal(1) - sum(rounded)).quantize(quantum)
    if final < 0:
        raise ValueError("rounded portfolio weights are infeasible")
    return tuple(format(value, "f") for value in (*rounded, final))
