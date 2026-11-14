import { useMutation, useQuery } from "@tanstack/react-query";

import {
  getCryptoForecast,
  getPortfolioRecommendation,
  type RecommendationCommand,
} from "../../lib/api/client";

export function useCryptoDashboard(accessToken: string) {
  const forecast = useQuery({
    queryKey: ["crypto-forecast", accessToken] as const,
    queryFn: ({ signal }) => getCryptoForecast(accessToken, signal),
  });
  const recommendation = useMutation({
    mutationFn: (body: RecommendationCommand) =>
      getPortfolioRecommendation(accessToken, body),
  });
  return { forecast, recommendation };
}
