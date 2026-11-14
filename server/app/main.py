from __future__ import annotations

import json
import os
from pathlib import Path

from fastapi import FastAPI

from blockchain.adapter.resfinance_settlement import LocalResContractCliGateway
from server.app.api.auth import create_auth_router
from server.app.api.crypto_intelligence import create_crypto_intelligence_router
from server.app.api.finance import create_finance_router
from server.app.api.groups import create_groups_router
from server.app.api.health import router as health_router
from server.app.api.insights import create_insights_router
from server.app.api.problems import register_problem_handlers
from server.app.application.authentication import AuthenticationService
from server.app.application.finance import FinanceService
from server.app.application.groups import GroupService
from server.app.application.insights import InsightsService
from server.app.application.phase2_portfolio import Phase2PortfolioService, load_phase2_policy
from server.app.application.portfolio import PortfolioService
from server.app.infrastructure.auth_repository import AuthRepository
from server.app.infrastructure.blob_repository import EncryptedBlobRepository
from server.app.infrastructure.crypto_repository import CryptoResearchRepository
from server.app.infrastructure.encryption import AesGcmCipher
from server.app.infrastructure.event_repository import EncryptedEventRepository
from server.app.infrastructure.huggingface_insights import HuggingFaceInstructionSelector
from server.app.infrastructure.phase1_forecast_repository import Phase1ForecastRepository
from server.app.infrastructure.portfolio_repository import PortfolioResearchRepository
from server.app.infrastructure.research_repository import ResearchRunRepository
from server.app.infrastructure.resilientdb_cli import ResilientDBCliStore


def create_app(
    auth_service: AuthenticationService | None = None,
    finance_service: FinanceService | None = None,
    group_service: GroupService | None = None,
    portfolio_service: PortfolioService | None = None,
    insights_service: InsightsService | None = None,
    *,
    phase2_portfolio_service: Phase2PortfolioService | None = None,
    secure_cookie: bool = False,
) -> FastAPI:
    app = FastAPI(
        title="ResFinance API",
        version="0.1.0",
        docs_url="/api/docs",
        openapi_url="/api/openapi.json",
    )
    register_problem_handlers(app)
    app.include_router(health_router, prefix="/api/v1")
    app.include_router(
        create_auth_router(auth_service, secure_cookie=secure_cookie),
        prefix="/api/v1",
    )
    app.include_router(
        create_finance_router(finance_service, auth_service),
        prefix="/api/v1",
    )
    app.include_router(
        create_groups_router(group_service, auth_service),
        prefix="/api/v1",
    )
    app.include_router(
        create_crypto_intelligence_router(phase2_portfolio_service, auth_service),
        prefix="/api/v1",
    )
    app.include_router(
        create_insights_router(insights_service, auth_service),
        prefix="/api/v1",
    )
    return app


def services_from_environment() -> tuple[
    AuthenticationService | None,
    FinanceService | None,
    GroupService | None,
    PortfolioService | None,
    InsightsService | None,
    Phase2PortfolioService | None,
]:
    tool = os.environ.get("RESFINANCE_RESDB_TOOL")
    config = os.environ.get("RESFINANCE_RESDB_CONFIG")
    if not tool or not config:
        return None, None, None, None, None, None
    store = ResilientDBCliStore(tool=Path(tool), config_path=Path(config))
    authentication = AuthenticationService(AuthRepository(store))
    event_key_path = os.environ.get("RESFINANCE_EVENT_KEY_FILE")
    if not event_key_path:
        return authentication, None, None, None, None, None
    key = Path(event_key_path).read_bytes()
    research_key_path = os.environ.get("RESFINANCE_RESEARCH_KEY_FILE", event_key_path)
    research_key = Path(research_key_path).read_bytes()
    repository = EncryptedEventRepository(
        store,
        AesGcmCipher(key, key_id="local-finance-event-key-v1"),
    )
    finance = FinanceService(repository)
    phase2_policy = load_phase2_policy(
        Path(
            os.environ.get(
                "RESFINANCE_PHASE2_POLICY_CONFIG",
                "config/crypto-intelligence/phase2-portfolio-cash-v2.json",
            )
        )
    )
    contract_tool = os.environ.get("RESFINANCE_RESCONTRACT_TOOL")
    contract_config = os.environ.get("RESFINANCE_RESCONTRACT_CONFIG")
    contract_address = os.environ.get("RESFINANCE_RESCONTRACT_ADDRESS")
    gateway_caller = os.environ.get("RESFINANCE_RESCONTRACT_CALLER")
    registry_path = os.environ.get("RESFINANCE_RESCONTRACT_REGISTRY")
    if registry_path and (not contract_address or not gateway_caller):
        registry = json.loads(Path(registry_path).read_text(encoding="utf-8"))
        contract_address = str(registry.get("contract_address", ""))
        gateway_caller = str(registry.get("gateway_caller", ""))
    if not all((contract_tool, contract_config, contract_address, gateway_caller)):
        blobs = EncryptedBlobRepository(
            store,
            AesGcmCipher(research_key, key_id="local-research-blob-key-v1"),
        )
        research = ResearchRunRepository(store, blobs)
        portfolio = PortfolioService(
            repository,
            PortfolioResearchRepository(store, research),
            finance,
        )
        phase2 = Phase2PortfolioService(
            Phase1ForecastRepository(store, blobs, CryptoResearchRepository(store)),
            policy=phase2_policy,
        )
        insights = _insights_service(finance, portfolio, None)
        return authentication, finance, None, portfolio, insights, phase2
    contract = LocalResContractCliGateway(
        tool=Path(str(contract_tool)),
        config_path=Path(str(contract_config)),
        contract_address=str(contract_address),
        gateway_caller=str(gateway_caller),
    )
    blobs = EncryptedBlobRepository(
        store,
        AesGcmCipher(research_key, key_id="local-research-blob-key-v1"),
    )
    research = ResearchRunRepository(store, blobs)
    portfolio = PortfolioService(repository, PortfolioResearchRepository(store, research), finance)
    phase2 = Phase2PortfolioService(
        Phase1ForecastRepository(store, blobs, CryptoResearchRepository(store)),
        policy=phase2_policy,
    )
    groups = GroupService(repository, contract, finance)
    insights = _insights_service(finance, portfolio, groups)
    return authentication, finance, groups, portfolio, insights, phase2


def _insights_service(
    finance: FinanceService,
    portfolio: PortfolioService,
    groups: GroupService | None,
) -> InsightsService:
    selector = None
    if os.environ.get("RESFINANCE_AI_ENABLED", "false").lower() == "true":
        configured_path = os.environ.get("RESFINANCE_AI_MODEL_PATH")
        selector = HuggingFaceInstructionSelector(
            model_path=Path(configured_path) if configured_path else None
        )
    return InsightsService(finance, portfolio, groups, selector)


_authentication, _finance, _groups, _portfolio, _insights, _phase2 = services_from_environment()
app = create_app(
    _authentication,
    _finance,
    _groups,
    _portfolio,
    _insights,
    phase2_portfolio_service=_phase2,
    secure_cookie=os.environ.get("RESFINANCE_SECURE_COOKIE", "false").lower() == "true",
)
