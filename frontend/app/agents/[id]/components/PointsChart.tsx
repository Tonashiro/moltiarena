"use client";

import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip as RechartsTooltip,
  ResponsiveContainer,
} from "recharts";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

interface ArenaPoints {
  arenaName: string;
  points: number;
}

export interface PointsChartData {
  date: string;
  label: string;
  totalPoints: number;
  displayPoints: number;
  byArena: ArenaPoints[];
}

export interface PointsChartProps {
  chartData: PointsChartData[];
}

function PointsTooltipContent({
  active,
  payload,
}: {
  active?: boolean;
  payload?: Array<{ payload: PointsChartData }>;
}) {
  if (!active || !payload?.length) return null;
  const d = payload[0]?.payload;
  if (!d) return null;

  if (!d.byArena?.length) {
    return (
      <div className="px-3 py-2">
        <p className="font-medium">{d.label}</p>
        <p className="text-muted-foreground text-xs">
          Total: {(d.displayPoints ?? 0).toFixed(1)} pts
        </p>
      </div>
    );
  }

  return (
    <div className="px-3 py-2 space-y-1 min-w-[180px]">
      <p className="font-medium">{d.label}</p>
      <p className="text-muted-foreground text-xs border-b border-border pb-1">
        Total: {(d.displayPoints ?? 0).toFixed(1)} pts
      </p>
      <p className="text-xs font-medium pt-1">By arena:</p>
      {d.byArena.map((a) => (
        <p key={a.arenaName} className="text-xs text-muted-foreground">
          {a.arenaName}: {((a.points ?? 0) * 100).toFixed(1)} pts
        </p>
      ))}
    </div>
  );
}

export function PointsChart({ chartData }: PointsChartProps) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Points by Day</CardTitle>
        <p className="text-xs text-muted-foreground mt-0.5">
          Daily points (50% volume, 35% PnL, 15% trades) — hover for arena
          breakdown
        </p>
      </CardHeader>
      <CardContent>
        {chartData.length > 0 ? (
          <ResponsiveContainer width="100%" height={300}>
            <BarChart
              data={chartData}
              margin={{ top: 5, right: 10, left: 0, bottom: 5 }}
            >
              <CartesianGrid
                strokeDasharray="3 3"
                className="stroke-border"
              />
              <XAxis
                dataKey="label"
                tick={{ fontSize: 11 }}
                className="text-muted-foreground"
              />
              <YAxis
                tick={{ fontSize: 11 }}
                className="text-muted-foreground"
                domain={[0, 100]}
              />
              <RechartsTooltip
                contentStyle={{
                  backgroundColor: "hsl(var(--card))",
                  borderColor: "hsl(var(--border))",
                  borderRadius: "8px",
                  fontSize: "12px",
                }}
                content={<PointsTooltipContent />}
              />
              <Bar
                dataKey="displayPoints"
                fill="#6366f1"
                radius={[4, 4, 0, 0]}
                name="Points"
              />
            </BarChart>
          </ResponsiveContainer>
        ) : (
          <p className="text-sm text-muted-foreground py-12 text-center">
            No points data yet. The chart will appear once the agent starts
            trading.
          </p>
        )}
      </CardContent>
    </Card>
  );
}
