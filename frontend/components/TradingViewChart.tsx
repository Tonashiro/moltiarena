"use client";

import { useMemo, useState, useEffect, useRef, useCallback } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { cn } from "@/app/lib/utils";
import {
  createChart,
  ColorType,
  IChartApi,
  ISeriesApi,
  CandlestickData,
  Time,
  CandlestickSeries,
} from "lightweight-charts";
import {
  TIMEFRAMES,
  CHART_TYPES,
  CURRENCIES,
  CHART_COLORS,
  CHART_CONFIG,
  getChartTypeParam,
  type Timeframe,
  type ChartType,
  type Currency,
} from "./chart/constants";
import { ToggleButtonGroup } from "./chart/ToggleButtonGroup";
import {
  getTimeframeConfig,
  convertToCandlestickData,
} from "./chart/utils";
import { fetchNadFunChartData } from "./chart/api";
import type {
  TradeMarker,
  TradingViewChartProps,
} from "./chart/types";

// Re-export types for backward compatibility
export type { TradeMarker, TradingViewChartProps };

/**
 * TradingView Chart Component using lightweight-charts with nad.fun data
 * Displays price chart with agent trade overlays
 */
export function TradingViewChart({
  tokenAddress,
  tokenSymbol,
  trades: _trades,
  height = 450,
}: TradingViewChartProps) {
  const chartContainerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const seriesRef = useRef<ISeriesApi<"Candlestick"> | null>(null);
  const fetchingRef = useRef<boolean>(false);
  const [selectedTimeframe, setTimeframe] = useState<Timeframe>("24h");
  const [chartType, setChartType] = useState<ChartType>("price");
  const [currency, setCurrency] = useState<Currency>("mon");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [chartData, setChartData] = useState<CandlestickData[]>([]);

  // Get timeframe configuration
  const timeframeConfig = useMemo(
    () => getTimeframeConfig(selectedTimeframe),
    [selectedTimeframe],
  );

  // Determine chart_type based on selections
  const chartTypeParam = useMemo(
    () => getChartTypeParam(chartType, currency),
    [chartType, currency],
  );

  // Fetch chart data from nad.fun API
  const fetchData = useCallback(async () => {
    if (!tokenAddress) return;
    if (fetchingRef.current) return; // Prevent concurrent fetches

    fetchingRef.current = true;
    setLoading(true);
    setError(null);

    const { resolution, from } = timeframeConfig;
    const to = Math.floor(Date.now() / 1000);

    try {
      const data = await fetchNadFunChartData(
        tokenAddress,
        resolution,
        from,
        to,
        chartTypeParam,
      );
      if (!data) {
        setError("Failed to load chart data");
        return;
      }
      const candlestickData = convertToCandlestickData(data);
      setChartData(candlestickData);
    } catch (err) {
      console.error("[TradingViewChart] Error loading chart:", err);
      setError("Error loading chart data");
    } finally {
      setLoading(false);
      fetchingRef.current = false;
    }
  }, [tokenAddress, timeframeConfig, chartTypeParam]);

  // Initial fetch and periodic updates - depend on actual values, not fetchData callback
  useEffect(() => {
    if (!tokenAddress) return;
    
    fetchData();
    
    // Poll for updates periodically (less frequent than trades to avoid API overload)
    const intervalId = setInterval(() => {
      fetchData();
    }, CHART_CONFIG.pollInterval);

    return () => {
      clearInterval(intervalId);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tokenAddress, selectedTimeframe, chartType, currency]); // Depend on actual values, not fetchData

  // Initialize chart (only once, then update data)
  useEffect(() => {
    if (!chartContainerRef.current) return;
    if (chartRef.current) return; // Chart already exists

    // Create chart only once
    const chart = createChart(chartContainerRef.current, {
      layout: {
        background: { type: ColorType.Solid, color: "transparent" },
        textColor: CHART_COLORS.text,
      },
      grid: {
        vertLines: { color: CHART_COLORS.border },
        horzLines: { color: CHART_COLORS.border },
      },
      width: chartContainerRef.current.clientWidth,
      height: height,
      timeScale: {
        timeVisible: true,
        secondsVisible: false,
      },
      rightPriceScale: {
        borderColor: CHART_COLORS.border,
        scaleMargins: CHART_CONFIG.scaleMargins,
      },
      leftPriceScale: {
        visible: false, // Hide left price scale since we use right
      },
    });

    const candlestickSeries = chart.addSeries(CandlestickSeries, {
      upColor: CHART_COLORS.up,
      downColor: CHART_COLORS.down,
      borderVisible: false,
      wickUpColor: CHART_COLORS.up,
      wickDownColor: CHART_COLORS.down,
      priceFormat: CHART_CONFIG.priceFormat,
    });

    chartRef.current = chart;
    seriesRef.current = candlestickSeries;

    // Handle resize
    const handleResize = () => {
      if (chartContainerRef.current && chartRef.current) {
        chartRef.current.applyOptions({
          width: chartContainerRef.current.clientWidth,
        });
      }
    };

    window.addEventListener("resize", handleResize);

    return () => {
      window.removeEventListener("resize", handleResize);
      if (chartRef.current) {
        chartRef.current.remove();
        chartRef.current = null;
        seriesRef.current = null;
      }
    };
  }, [height]); // Only recreate if height changes

  // Update series data when chartData changes
  useEffect(() => {
    if (seriesRef.current && chartData.length > 0) {
      seriesRef.current.setData(chartData);
    }
  }, [chartData]);

  // Hide chart when request fails (e.g. nad.fun 500)
  if (error) {
    return null;
  }

  return (
    <Card>
      <CardHeader>
        <div className="flex flex-col gap-4">
          <div className="flex items-center justify-between flex-wrap gap-4">
            <CardTitle>Price Chart</CardTitle>
            <div className="flex items-center gap-2">
              {TIMEFRAMES.map((tf) => (
                <button
                  key={tf}
                  onClick={() => setTimeframe(tf)}
                  className={cn(
                    "px-3 py-1 text-xs rounded-md transition-colors",
                    selectedTimeframe === tf
                      ? "bg-primary text-primary-foreground"
                      : "bg-muted hover:bg-muted/80 text-muted-foreground",
                  )}
                >
                  {tf}
                </button>
              ))}
            </div>
          </div>

          {/* Chart Type Toggles */}
          <div className="flex items-center gap-4 flex-wrap">
            <ToggleButtonGroup
              options={CHART_TYPES}
              value={chartType}
              onChange={setChartType}
              label="View:"
            />
            <ToggleButtonGroup
              options={CURRENCIES}
              value={currency}
              onChange={setCurrency}
              label="Currency:"
            />
          </div>
        </div>
      </CardHeader>
      <CardContent>
        <div className="relative" style={{ height: `${height}px` }}>
          {/* TradingView Chart Container */}
          <div
            ref={chartContainerRef}
            className="absolute inset-0 rounded-lg overflow-hidden"
            style={{ height: `${height}px`, zIndex: 1 }}
          />

          {/* Loading State */}
          {loading && (
            <div className="absolute inset-0 flex items-center justify-center bg-background/90 backdrop-blur-sm z-30">
              <div className="flex flex-col items-center gap-2">
                <div className="w-8 h-8 border-4 border-primary border-t-transparent rounded-full animate-spin" />
                <p className="text-sm text-muted-foreground">
                  Loading chart data...
                </p>
              </div>
            </div>
          )}

          {/* Link to nad.fun */}
          <div className="absolute top-4 right-4 z-20">
            <a
              href={`https://nad.fun/tokens/${tokenAddress}`}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1.5 px-2 py-1 text-xs bg-background/90 backdrop-blur-sm border border-border rounded-md hover:bg-background transition-colors text-muted-foreground hover:text-foreground pointer-events-auto"
            >
              <svg
                className="w-3 h-3"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14"
                />
              </svg>
              View on nad.fun
            </a>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
