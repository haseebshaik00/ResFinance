import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import {
  getFinanceOverview,
  getCryptoForecast,
  getCryptoRiskProfile,
  getPortfolioRecommendation,
  saveCryptoRiskProfile,
  type CryptoRiskProfileCommand,
  type RecommendationCommand,
} from "../../lib/api/client";

export function useCryptoDashboard(accessToken: string, savingsMonth: string) {
  const queryClient = useQueryClient();
  const forecast = useQuery({
    queryKey: ["crypto-forecast", accessToken] as const,
    queryFn: ({ signal }) => getCryptoForecast(accessToken, signal),
  });
  const financeOverview = useQuery({
    queryKey: ["finance-overview", accessToken, savingsMonth] as const,
    queryFn: ({ signal }) =>
      getFinanceOverview(accessToken, savingsMonth, signal),
  });
  const recommendation = useMutation({
    mutationFn: (body: RecommendationCommand) =>
      getPortfolioRecommendation(accessToken, body),
  });
  const riskProfile = useQuery({
    queryKey: ["crypto-risk-profile", accessToken] as const,
    queryFn: ({ signal }) => getCryptoRiskProfile(accessToken, signal),
  });
  const saveRiskProfile = useMutation({
    mutationFn: (body: CryptoRiskProfileCommand) =>
      saveCryptoRiskProfile(accessToken, crypto.randomUUID(), body),
    onSuccess: async () => {
      await queryClient.invalidateQueries({
        queryKey: ["crypto-risk-profile", accessToken],
      });
    },
  });
  return {
    forecast,
    financeOverview,
    recommendation,
    riskProfile,
    saveRiskProfile,
  };
}
