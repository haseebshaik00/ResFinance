import {
  useMutation,
  useQueries,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";

import {
  addGroupMember,
  createGroup,
  createGroupExpense,
  decideGroupObligation,
  fundGroupCredits,
  getGroupOverview,
  listGroups,
  settleGroupObligation,
  type AddMemberCommand,
  type CreateExpenseCommand,
  type CreateGroupCommand,
  type FundCreditsCommand,
  type ObligationDecisionCommand,
  type SettleObligationCommand,
} from "../../lib/api/client";

interface Command<T> {
  body: T;
  idempotencyKey: string;
}

interface GroupCommand<T> extends Command<T> {
  groupId: string;
}

interface ObligationCommand<T> extends GroupCommand<T> {
  obligationId: string;
}

export function useGroupsDashboard(
  accessToken: string,
  selectedGroupId: string | null,
) {
  const queryClient = useQueryClient();
  const groups = useQuery({
    queryKey: ["groups", accessToken],
    queryFn: ({ signal }) => listGroups(accessToken, signal),
  });
  const overview = useQuery({
    queryKey: ["group", accessToken, selectedGroupId],
    queryFn: ({ signal }) =>
      getGroupOverview(accessToken, selectedGroupId!, signal),
    enabled: selectedGroupId !== null,
  });
  const overviews = useQueries({
    queries: (groups.data ?? []).map((group) => ({
      queryKey: ["group", accessToken, group.group_id],
      queryFn: ({ signal }: { signal: AbortSignal }) =>
        getGroupOverview(accessToken, group.group_id, signal),
    })),
  });

  async function refresh(groupId?: string) {
    await queryClient.invalidateQueries({ queryKey: ["groups", accessToken] });
    if (groupId !== undefined) {
      await queryClient.invalidateQueries({
        queryKey: ["group", accessToken, groupId],
      });
      await queryClient.invalidateQueries({
        queryKey: ["finance", accessToken],
      });
    }
  }

  const create = useMutation({
    mutationFn: ({ body, idempotencyKey }: Command<CreateGroupCommand>) =>
      createGroup(accessToken, idempotencyKey, body),
    onSuccess: () => refresh(),
  });
  const member = useMutation({
    mutationFn: ({
      groupId,
      body,
      idempotencyKey,
    }: GroupCommand<AddMemberCommand>) =>
      addGroupMember(accessToken, groupId, idempotencyKey, body),
    onSuccess: (_, variables) => refresh(variables.groupId),
  });
  const expense = useMutation({
    mutationFn: ({
      groupId,
      body,
      idempotencyKey,
    }: GroupCommand<CreateExpenseCommand>) =>
      createGroupExpense(accessToken, groupId, idempotencyKey, body),
    onSuccess: (_, variables) => refresh(variables.groupId),
  });
  const decision = useMutation({
    mutationFn: ({
      groupId,
      obligationId,
      body,
      idempotencyKey,
    }: ObligationCommand<ObligationDecisionCommand>) =>
      decideGroupObligation(
        accessToken,
        groupId,
        obligationId,
        idempotencyKey,
        body,
      ),
    onSuccess: (_, variables) => refresh(variables.groupId),
  });
  const credits = useMutation({
    mutationFn: ({
      groupId,
      body,
      idempotencyKey,
    }: GroupCommand<FundCreditsCommand>) =>
      fundGroupCredits(accessToken, groupId, idempotencyKey, body),
    onSuccess: (_, variables) => refresh(variables.groupId),
  });
  const settlement = useMutation({
    mutationFn: ({
      groupId,
      obligationId,
      body,
      idempotencyKey,
    }: ObligationCommand<SettleObligationCommand>) =>
      settleGroupObligation(
        accessToken,
        groupId,
        obligationId,
        idempotencyKey,
        body,
      ),
    onSuccess: (_, variables) => refresh(variables.groupId),
  });

  return {
    groups,
    overview,
    overviews,
    create,
    member,
    expense,
    decision,
    credits,
    settlement,
  };
}
