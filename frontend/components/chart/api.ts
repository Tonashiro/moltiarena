/**
 * API functions for fetching chart data from nad.fun
 */

import type { NadFunChartResponse, ChartTypeParam } from "./types";

/**
 * Fetch chart data from nad.fun API.
 * Request format is unchanged; 500 usually means nad.fun server/rate-limit issue.
 */
export async function fetchNadFunChartData(
  tokenAddress: string,
  resolution: string,
  from: number,
  to: number,
  chartType: ChartTypeParam,
): Promise<NadFunChartResponse | null> {
  const url = `https://api.nadapp.net/trade/chart/${tokenAddress}?resolution=${resolution}&from=${from}&to=${to}&countback=500&chart_type=${chartType}`;

  try {
    let response = await fetch(url);
    if (response.status === 500) {
      // Retry once after 2s (500 often transient or rate-limit on their side)
      await new Promise((r) => setTimeout(r, 2000));
      response = await fetch(url);
    }
    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      console.error(
        `[Chart API] Failed to fetch chart data: ${response.status}`,
        { url, status: response.status, body: errorData },
      );
      return null;
    }
    const data = await response.json();
    if (data.s !== "ok") {
      console.error(`[Chart API] API returned error: ${data.s}`, data);
      return null;
    }
    return data;
  } catch (error) {
    console.error("[Chart API] Error fetching chart data:", error);
    return null;
  }
}
