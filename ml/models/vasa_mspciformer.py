from __future__ import annotations

from enum import StrEnum
from typing import NamedTuple, cast

import torch
from torch import Tensor, nn
from torch.nn import functional as F

from ml.data.market_daily import ASSETS, FORECAST_DAYS


class ScaleAggregation(StrEnum):
    GLOBAL = "global-learned"
    VOLATILITY_ADAPTIVE = "volatility-adaptive"


class PriceForecastOutput(NamedTuple):
    standardized_log_prices: Tensor
    scale_weights: Tensor
    scale_predictions: Tensor


class ChannelIndependentPriceScale(nn.Module):
    """Encode each price channel independently with shared scale-specific weights."""

    def __init__(
        self,
        *,
        lookback: int,
        patch_size: int,
        stride: int,
        model_dimension: int,
        heads: int,
        layers: int,
        dropout: float,
    ) -> None:
        super().__init__()
        if patch_size > lookback:
            raise ValueError("patch size cannot exceed the input lookback")
        self.patch_size = patch_size
        self.stride = stride
        self.patch_count = ((lookback + stride - patch_size) // stride) + 1
        self.projection = nn.Linear(patch_size, model_dimension)
        self.position = nn.Parameter(torch.zeros(1, self.patch_count, model_dimension))
        layer = nn.TransformerEncoderLayer(
            d_model=model_dimension,
            nhead=heads,
            dim_feedforward=model_dimension * 2,
            dropout=dropout,
            activation="gelu",
            batch_first=True,
            norm_first=True,
        )
        self.encoder = nn.TransformerEncoder(
            layer,
            num_layers=layers,
            enable_nested_tensor=False,
        )
        self.head = nn.Sequential(
            nn.Flatten(start_dim=1),
            nn.Dropout(dropout),
            nn.Linear(self.patch_count * model_dimension, FORECAST_DAYS),
        )
        final = cast(nn.Linear, self.head[-1])
        nn.init.zeros_(final.weight)
        nn.init.zeros_(final.bias)

    def forward(self, values: Tensor) -> Tensor:
        if values.ndim != 3 or values.shape[2] != len(ASSETS):
            raise ValueError("market inputs must have shape [batch, lookback, 3]")
        batch, _, channels = values.shape
        series = values.transpose(1, 2)
        series = F.pad(series, (0, self.stride), mode="replicate")
        patches = series.unfold(dimension=2, size=self.patch_size, step=self.stride)
        if patches.shape[2] != self.patch_count:
            raise ValueError("unexpected patch count")
        tokens = self.projection(patches).reshape(
            batch * channels,
            self.patch_count,
            self.projection.out_features,
        )
        encoded = self.encoder(tokens + self.position)
        residual = self.head(encoded).reshape(batch, channels, FORECAST_DAYS)
        last = values[:, -1].unsqueeze(-1)
        return cast(Tensor, (last + residual).transpose(1, 2))


class MarketMSPCIFormer(nn.Module):
    """Clean-room market-only MSPCIFormer with optional VASA aggregation."""

    def __init__(
        self,
        *,
        aggregation: ScaleAggregation,
        lookback: int = 5,
        patch_sizes: tuple[int, ...] = (4, 5),
        stride: int = 2,
        model_dimension: int = 16,
        heads: int = 2,
        layers: int = 1,
        dropout: float = 0.2,
        volatility_hidden: int = 8,
    ) -> None:
        super().__init__()
        if not patch_sizes or any(size <= 0 for size in patch_sizes):
            raise ValueError("patch sizes must be positive")
        self.aggregation = aggregation
        self.patch_sizes = patch_sizes
        self.scales = nn.ModuleList(
            ChannelIndependentPriceScale(
                lookback=lookback,
                patch_size=size,
                stride=stride,
                model_dimension=model_dimension,
                heads=heads,
                layers=layers,
                dropout=dropout,
            )
            for size in patch_sizes
        )
        self.base_scale_logits = nn.Parameter(torch.zeros(len(patch_sizes)))
        if aggregation is ScaleAggregation.VOLATILITY_ADAPTIVE:
            volatility_network = nn.Sequential(
                nn.Linear(1, volatility_hidden),
                nn.GELU(),
                nn.Linear(volatility_hidden, len(patch_sizes)),
            )
            self.volatility_network: nn.Module | None = volatility_network
            last = cast(nn.Linear, volatility_network[-1])
            nn.init.zeros_(last.weight)
            nn.init.zeros_(last.bias)
        else:
            self.volatility_network = None

    def forward(self, values: Tensor, recent_volatility: Tensor) -> PriceForecastOutput:
        if recent_volatility.shape != (values.shape[0], len(ASSETS)):
            raise ValueError("recent volatility must have shape [batch, 3]")
        predictions = torch.stack([scale(values) for scale in self.scales], dim=-1)
        logits = self.base_scale_logits.reshape(1, 1, -1).expand(values.shape[0], len(ASSETS), -1)
        if self.volatility_network is not None:
            adjustment = self.volatility_network(recent_volatility.unsqueeze(-1))
            logits = logits + adjustment
        weights = torch.softmax(logits, dim=-1)
        forecast = (predictions * weights.unsqueeze(1)).sum(dim=-1)
        return PriceForecastOutput(forecast, weights, predictions)


def model_config(model: MarketMSPCIFormer) -> dict[str, object]:
    first = cast(ChannelIndependentPriceScale, model.scales[0])
    return {
        "architecture": "market-only-mspciformer-v1",
        "aggregation": model.aggregation.value,
        "forecast_days": FORECAST_DAYS,
        "assets": [asset.value for asset in ASSETS],
        "patch_sizes": list(model.patch_sizes),
        "stride": first.stride,
        "model_dimension": first.projection.out_features,
        "scale_count": len(model.scales),
    }


def parameter_count(model: nn.Module) -> int:
    return sum(parameter.numel() for parameter in model.parameters() if parameter.requires_grad)
