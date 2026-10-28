import type { components, paths } from "./generated/schema";
import type {
  SignedIntent,
  WalletIdentity,
} from "../../features/auth/reswallet";

type HealthResponse =
  paths["/api/v1/health"]["get"]["responses"][200]["content"]["application/json"];

export async function getHealth(signal?: AbortSignal): Promise<HealthResponse> {
  const request: RequestInit = { headers: { Accept: "application/json" } };
  if (signal !== undefined) {
    request.signal = signal;
  }
  const response = await fetch("/api/v1/health", request);
  if (!response.ok) {
    throw new Error(`Health request failed with ${response.status}`);
  }
  return (await response.json()) as HealthResponse;
}

type ChallengeResponse =
  paths["/api/v1/auth/challenges"]["post"]["responses"][201]["content"]["application/json"];
type SessionResponse =
  paths["/api/v1/auth/sessions"]["post"]["responses"][201]["content"]["application/json"];
export type FinanceOverview = components["schemas"]["FinanceOverviewModel"];
export type CategoryCommand = components["schemas"]["CategoryCommand"];
export type TransactionCommand = components["schemas"]["TransactionCommand"];
export type VoidTransactionCommand =
  components["schemas"]["VoidTransactionCommand"];
export type BudgetCommand = components["schemas"]["BudgetCommand"];
export type DeactivateBudgetCommand =
  components["schemas"]["DeactivateBudgetCommand"];
export type RecurringEntryCommand =
  components["schemas"]["RecurringEntryCommand"];
export type DeactivateRecurringCommand =
  components["schemas"]["DeactivateRecurringCommand"];
export type FinanceEvent = components["schemas"]["EventResponse"];
export type GroupSummary = components["schemas"]["GroupSummaryModel"];
export type GroupOverview = components["schemas"]["GroupOverviewModel"];
export type CreateGroupCommand = components["schemas"]["CreateGroupCommand"];
export type AddMemberCommand = components["schemas"]["AddMemberCommand"];
export type CreateExpenseCommand =
  components["schemas"]["CreateExpenseCommand"];
export type ObligationDecisionCommand =
  components["schemas"]["ObligationDecisionCommand"];
export type FundCreditsCommand = components["schemas"]["FundCreditsCommand"];
export type SettleObligationCommand =
  components["schemas"]["SettleObligationCommand"];
export type CryptoOverview = components["schemas"]["CryptoOverviewModel"];
export type RiskProfileCommand = components["schemas"]["RiskProfileCommand"];
export type RiskProfileEvent =
  components["schemas"]["RiskProfileEventResponse"];
export type ScenarioCommand = components["schemas"]["ScenarioCommand"];
export type PortfolioRecommendation =
  components["schemas"]["RecommendationModel"];
export type InsightsOverview = components["schemas"]["InsightsOverviewModel"];
export type InsightResponse = components["schemas"]["InsightResponseModel"];
export type InsightQuery = components["schemas"]["InsightQueryModel"];

export async function createChallenge(
  identity: WalletIdentity,
): Promise<ChallengeResponse> {
  return requestJson<ChallengeResponse>("/api/v1/auth/challenges", {
    method: "POST",
    headers: jsonHeaders(),
    credentials: "include",
    body: JSON.stringify({ wallet: identity }),
  });
}

export async function createSession(
  challenge: string,
  intent: SignedIntent,
): Promise<SessionResponse> {
  return requestJson<SessionResponse>("/api/v1/auth/sessions", {
    method: "POST",
    headers: jsonHeaders(),
    credentials: "include",
    body: JSON.stringify({ challenge, intent }),
  });
}

export async function logoutSession(accessToken: string): Promise<void> {
  const response = await fetch("/api/v1/auth/sessions/current", {
    method: "DELETE",
    headers: {
      Accept: "application/json",
      Authorization: `Bearer ${accessToken}`,
    },
    credentials: "include",
  });
  if (!response.ok) throw new Error(await problemMessage(response));
}

export async function getFinanceOverview(
  accessToken: string,
  month: string,
  signal?: AbortSignal,
): Promise<FinanceOverview> {
  const request: RequestInit = {
    headers: authorizedHeaders(accessToken),
    credentials: "include",
  };
  if (signal !== undefined) request.signal = signal;
  return requestJson<FinanceOverview>(
    `/api/v1/finance/overview?month=${encodeURIComponent(month)}`,
    request,
  );
}

export async function getCryptoOverview(
  accessToken: string,
  month: string,
  signal?: AbortSignal,
): Promise<CryptoOverview> {
  const request: RequestInit = {
    headers: authorizedHeaders(accessToken),
    credentials: "include",
  };
  if (signal !== undefined) request.signal = signal;
  return requestJson<CryptoOverview>(
    `/api/v1/crypto/overview?month=${encodeURIComponent(month)}`,
    request,
  );
}

export async function getInsightsOverview(
  accessToken: string,
  month: string,
  signal?: AbortSignal,
): Promise<InsightsOverview> {
  const request: RequestInit = {
    headers: authorizedHeaders(accessToken),
    credentials: "include",
  };
  if (signal !== undefined) request.signal = signal;
  return requestJson<InsightsOverview>(
    `/api/v1/insights/overview?month=${encodeURIComponent(month)}`,
    request,
  );
}

const INSIGHTS_QUERY_TIMEOUT_MS = 30_000;

export async function queryInsights(
  accessToken: string,
  command: InsightQuery,
): Promise<InsightResponse> {
  const controller = new AbortController();
  const timeout = globalThis.setTimeout(
    () => controller.abort(),
    INSIGHTS_QUERY_TIMEOUT_MS,
  );
  try {
    return await requestJson<InsightResponse>("/api/v1/insights/query", {
      method: "POST",
      headers: {
        ...authorizedHeaders(accessToken),
        "Content-Type": "application/json",
      },
      credentials: "include",
      body: JSON.stringify(command),
      signal: controller.signal,
    });
  } catch (error) {
    if (controller.signal.aborted) {
      throw new Error("The evidence check took too long. Please try again.", {
        cause: error,
      });
    }
    throw error;
  } finally {
    globalThis.clearTimeout(timeout);
  }
}

export function recordRiskProfile(
  accessToken: string,
  idempotencyKey: string,
  command: RiskProfileCommand,
): Promise<RiskProfileEvent> {
  return requestJson<RiskProfileEvent>("/api/v1/crypto/risk-profile", {
    method: "POST",
    headers: {
      ...authorizedHeaders(accessToken),
      "Content-Type": "application/json",
      "Idempotency-Key": idempotencyKey,
    },
    credentials: "include",
    body: JSON.stringify(command),
  });
}

export function analyzePortfolioScenario(
  accessToken: string,
  command: ScenarioCommand,
): Promise<PortfolioRecommendation> {
  return requestJson<PortfolioRecommendation>("/api/v1/crypto/scenarios", {
    method: "POST",
    headers: {
      ...authorizedHeaders(accessToken),
      "Content-Type": "application/json",
    },
    credentials: "include",
    body: JSON.stringify(command),
  });
}

export async function createFinanceCategory(
  accessToken: string,
  idempotencyKey: string,
  command: CategoryCommand,
): Promise<FinanceEvent> {
  return financeCommand(
    "/api/v1/finance/categories",
    accessToken,
    idempotencyKey,
    command,
  );
}

export async function recordFinanceTransaction(
  accessToken: string,
  idempotencyKey: string,
  command: TransactionCommand,
): Promise<FinanceEvent> {
  return financeCommand(
    "/api/v1/finance/transactions",
    accessToken,
    idempotencyKey,
    command,
  );
}

export async function voidFinanceTransaction(
  accessToken: string,
  transactionId: string,
  idempotencyKey: string,
  command: VoidTransactionCommand,
): Promise<FinanceEvent> {
  return financeCommand(
    `/api/v1/finance/transactions/${encodeURIComponent(transactionId)}/void`,
    accessToken,
    idempotencyKey,
    command,
  );
}

export async function setFinanceBudget(
  accessToken: string,
  idempotencyKey: string,
  command: BudgetCommand,
): Promise<FinanceEvent> {
  return financeCommand(
    "/api/v1/finance/budgets",
    accessToken,
    idempotencyKey,
    command,
  );
}

export async function deactivateFinanceBudget(
  accessToken: string,
  budgetId: string,
  idempotencyKey: string,
  command: DeactivateBudgetCommand,
): Promise<FinanceEvent> {
  return financeCommand(
    `/api/v1/finance/budgets/${encodeURIComponent(budgetId)}/deactivate`,
    accessToken,
    idempotencyKey,
    command,
  );
}

export async function createFinanceRecurringEntry(
  accessToken: string,
  idempotencyKey: string,
  command: RecurringEntryCommand,
): Promise<FinanceEvent> {
  return financeCommand(
    "/api/v1/finance/recurring",
    accessToken,
    idempotencyKey,
    command,
  );
}

export async function deactivateFinanceRecurringEntry(
  accessToken: string,
  recurringEntryId: string,
  idempotencyKey: string,
  command: DeactivateRecurringCommand,
): Promise<FinanceEvent> {
  return financeCommand(
    `/api/v1/finance/recurring/${encodeURIComponent(recurringEntryId)}/deactivate`,
    accessToken,
    idempotencyKey,
    command,
  );
}

export async function listGroups(
  accessToken: string,
  signal?: AbortSignal,
): Promise<GroupSummary[]> {
  const request: RequestInit = {
    headers: authorizedHeaders(accessToken),
    credentials: "include",
  };
  if (signal !== undefined) request.signal = signal;
  return requestJson<GroupSummary[]>("/api/v1/groups", request);
}

export async function getGroupOverview(
  accessToken: string,
  groupId: string,
  signal?: AbortSignal,
): Promise<GroupOverview> {
  const request: RequestInit = {
    headers: authorizedHeaders(accessToken),
    credentials: "include",
  };
  if (signal !== undefined) request.signal = signal;
  return requestJson<GroupOverview>(
    `/api/v1/groups/${encodeURIComponent(groupId)}`,
    request,
  );
}

export function createGroup(
  accessToken: string,
  idempotencyKey: string,
  command: CreateGroupCommand,
): Promise<FinanceEvent> {
  return groupCommand("/api/v1/groups", accessToken, idempotencyKey, command);
}

export function addGroupMember(
  accessToken: string,
  groupId: string,
  idempotencyKey: string,
  command: AddMemberCommand,
): Promise<FinanceEvent> {
  return groupCommand(
    `/api/v1/groups/${encodeURIComponent(groupId)}/members`,
    accessToken,
    idempotencyKey,
    command,
  );
}

export function createGroupExpense(
  accessToken: string,
  groupId: string,
  idempotencyKey: string,
  command: CreateExpenseCommand,
): Promise<FinanceEvent> {
  return groupCommand(
    `/api/v1/groups/${encodeURIComponent(groupId)}/expenses`,
    accessToken,
    idempotencyKey,
    command,
  );
}

export function decideGroupObligation(
  accessToken: string,
  groupId: string,
  obligationId: string,
  idempotencyKey: string,
  command: ObligationDecisionCommand,
): Promise<FinanceEvent> {
  return groupCommand(
    `/api/v1/groups/${encodeURIComponent(groupId)}/obligations/${encodeURIComponent(obligationId)}/decision`,
    accessToken,
    idempotencyKey,
    command,
  );
}

export function fundGroupCredits(
  accessToken: string,
  groupId: string,
  idempotencyKey: string,
  command: FundCreditsCommand,
): Promise<FinanceEvent> {
  return groupCommand(
    `/api/v1/groups/${encodeURIComponent(groupId)}/credits`,
    accessToken,
    idempotencyKey,
    command,
  );
}

export function settleGroupObligation(
  accessToken: string,
  groupId: string,
  obligationId: string,
  idempotencyKey: string,
  command: SettleObligationCommand,
): Promise<FinanceEvent> {
  return groupCommand(
    `/api/v1/groups/${encodeURIComponent(groupId)}/obligations/${encodeURIComponent(obligationId)}/settlements`,
    accessToken,
    idempotencyKey,
    command,
  );
}

async function financeCommand<T extends object>(
  url: string,
  accessToken: string,
  idempotencyKey: string,
  command: T,
): Promise<FinanceEvent> {
  return requestJson<FinanceEvent>(url, {
    method: "POST",
    headers: {
      ...authorizedHeaders(accessToken),
      "Content-Type": "application/json",
      "Idempotency-Key": idempotencyKey,
    },
    credentials: "include",
    body: JSON.stringify(command),
  });
}

async function groupCommand<T extends object>(
  url: string,
  accessToken: string,
  idempotencyKey: string,
  command: T,
): Promise<FinanceEvent> {
  return financeCommand(url, accessToken, idempotencyKey, command);
}

async function requestJson<T>(url: string, request: RequestInit): Promise<T> {
  const response = await fetch(url, request);
  if (!response.ok) throw new Error(await problemMessage(response));
  return (await response.json()) as T;
}

function jsonHeaders(): HeadersInit {
  return { Accept: "application/json", "Content-Type": "application/json" };
}

function authorizedHeaders(accessToken: string): Record<string, string> {
  return { Accept: "application/json", Authorization: `Bearer ${accessToken}` };
}

async function problemMessage(response: Response): Promise<string> {
  try {
    const problem = (await response.json()) as { detail?: unknown };
    if (typeof problem.detail === "string") return problem.detail;
  } catch {
    // A non-JSON proxy failure is summarized by its status below.
  }
  return `ResFinance request failed with ${response.status}`;
}
