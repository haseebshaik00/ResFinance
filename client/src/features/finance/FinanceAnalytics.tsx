import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Legend,
  Line,
  LineChart,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

import type { FinanceOverview } from "../../lib/api/client";
import {
  chartLegendWrapperStyle,
  chartTickStyle,
  chartTooltipContentStyle,
  chartTooltipCursor,
  chartTooltipItemStyle,
  chartTooltipLabelStyle,
} from "../../lib/chartTooltip";
import { formatUsd } from "./money";
import {
  buildSavingsBreakdownSteps,
  type SavingsBreakdownStep,
} from "./savingsBreakdown";

/** High-contrast teal / gold / red-coral map — fixed per category so slices stay distinct. */
const categoryColorByName: Record<string, string> = {
  "Food & Groceries": "#38d1c5",
  Utilities: "#f2bd5a",
  Entertainment: "#ff5c6c",
  "Medical Bills": "#e76f51",
  Rent: "#2bbbad",
  Shopping: "#ffb703",
  Miscellaneous: "#e63946",
};

const chartColorFallback = [
  "#38d1c5",
  "#f2bd5a",
  "#ff5c6c",
  "#e76f51",
  "#2bbbad",
  "#ffb703",
  "#e63946",
  "#8ecae6",
];

function categoryChartColor(name: string, index: number): string {
  return (
    categoryColorByName[name] ??
    chartColorFallback[index % chartColorFallback.length]!
  );
}

interface FinanceAnalyticsProps {
  overview: FinanceOverview;
  historyMonths: string[];
  history: Array<FinanceOverview | undefined>;
}

export function FinanceAnalytics({
  overview,
  historyMonths,
  history,
}: FinanceAnalyticsProps) {
  const categoryData = categorySpending(overview);
  const savingsBreakdown = buildSavingsBreakdownSteps(overview.summary);
  const monthlyData = historyMonths.flatMap((month, index) => {
    const item = history[index];
    return item === undefined
      ? []
      : [
          {
            month,
            label: shortMonth(month),
            income: item.summary.income.minor_units,
            expenses: item.summary.expense.minor_units,
            savings: item.summary.savings.available.minor_units,
          },
        ];
  });

  return (
    <section className="finance-analytics" aria-labelledby="analytics-title">
      <div className="dashboard-section-heading">
        <div>
          <p className="section-kicker">Spending patterns</p>
          <h2 id="analytics-title">Your Financial Trends</h2>
          <p className="section-description">
            Charts use your recorded ledger and upcoming recurring commitments.
          </p>
        </div>
      </div>
      <div className="analytics-grid">
        <CategorySplitChart data={categoryData} />
        <SavingsBreakdownChart data={savingsBreakdown} />
        <CashFlowTrendChart data={monthlyData} />
      </div>
    </section>
  );
}

function CategorySplitChart({ data }: { data: CategoryDatum[] }) {
  return (
    <ChartCard title="Spending by category" description="This reporting month">
      {data.length === 0 ? (
        <EmptyChart text="Record an expense to see its category split." />
      ) : (
        <div
          className="analytics-chart"
          role="img"
          aria-label={`Category spending: ${data.map((item) => `${item.name} ${formatUsd(item.amount)}`).join(", ")}`}
        >
          {data.length === 1 ? (
            <div className="single-category-chart">
              <span
                className="single-category-donut"
                style={{
                  background: `conic-gradient(${categoryChartColor(data[0]!.name, 0)} 0 100%)`,
                }}
                aria-hidden="true"
              />
              <span className="single-category-legend">
                <i
                  style={{
                    background: categoryChartColor(data[0]!.name, 0),
                  }}
                  aria-hidden="true"
                />
                <span>
                  <strong>{data[0]!.name}</strong>
                  <small>{formatUsd(data[0]!.amount)} · 100%</small>
                </span>
              </span>
            </div>
          ) : (
            <ResponsiveContainer width="100%" height={260}>
              <PieChart>
                <Pie
                  data={data}
                  dataKey="amount"
                  nameKey="name"
                  cx="45%"
                  cy="50%"
                  innerRadius={46}
                  outerRadius={88}
                  paddingAngle={3}
                  stroke="var(--panel-background)"
                  strokeWidth={2}
                >
                  {data.map((item, index) => (
                    <Cell
                      key={item.categoryId}
                      fill={categoryChartColor(item.name, index)}
                    />
                  ))}
                </Pie>
                <Legend
                  layout="vertical"
                  verticalAlign="middle"
                  align="right"
                  wrapperStyle={chartLegendWrapperStyle}
                />
                <Tooltip
                  contentStyle={chartTooltipContentStyle}
                  labelStyle={chartTooltipLabelStyle}
                  itemStyle={chartTooltipItemStyle}
                  formatter={(value) => formatUsd(Number(value))}
                />
              </PieChart>
            </ResponsiveContainer>
          )}
        </div>
      )}
    </ChartCard>
  );
}

function SavingsBreakdownChart({ data }: { data: SavingsBreakdownStep[] }) {
  return (
    <ChartCard
      title="Savings breakdown"
      description="Ledger path to available savings"
    >
      {data.length === 0 ? (
        <EmptyChart text="Record income or expenses to see the savings path." />
      ) : (
        <div
          className="analytics-chart"
          role="img"
          aria-label={`Savings breakdown: ${data
            .map((item) => `${item.name} ${formatUsd(item.end)}`)
            .join(", ")}`}
        >
          <ResponsiveContainer width="100%" height={260}>
            <BarChart
              data={data}
              margin={{ top: 10, right: 8, left: 0, bottom: 28 }}
            >
              <CartesianGrid vertical={false} stroke="var(--chart-grid)" />
              <XAxis
                dataKey="name"
                interval={0}
                tick={chartTickStyle}
                angle={-28}
                textAnchor="end"
                height={52}
              />
              <YAxis
                tick={chartTickStyle}
                tickFormatter={compactUsd}
                width={56}
              />
              <Tooltip
                cursor={chartTooltipCursor}
                contentStyle={chartTooltipContentStyle}
                labelStyle={chartTooltipLabelStyle}
                itemStyle={chartTooltipItemStyle}
                formatter={(_value, _name, item) => {
                  const step = item.payload as SavingsBreakdownStep;
                  if (step.kind === "total") {
                    return [formatUsd(step.end), step.name];
                  }
                  const signed =
                    step.delta >= 0
                      ? `+${formatUsd(step.delta)}`
                      : formatUsd(step.delta);
                  return [`${signed} → ${formatUsd(step.end)}`, step.name];
                }}
              />
              <Bar
                dataKey="base"
                stackId="waterfall"
                fill="transparent"
                legendType="none"
                tooltipType="none"
                isAnimationActive={false}
              />
              <Bar
                dataKey="amount"
                stackId="waterfall"
                name="Amount"
                radius={[4, 4, 0, 0]}
              >
                {data.map((item) => (
                  <Cell key={item.name} fill={item.fill} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>
      )}
    </ChartCard>
  );
}

function CashFlowTrendChart({ data }: { data: MonthlyDatum[] }) {
  return (
    <ChartCard
      title="Cash flow over time"
      description="Exactly six reporting months"
    >
      <div
        className="analytics-chart"
        role="img"
        aria-label="Six month income, expenses, and available savings trend"
      >
        <ResponsiveContainer width="100%" height={260}>
          <LineChart
            data={data}
            margin={{ top: 10, right: 8, left: 0, bottom: 0 }}
          >
            <CartesianGrid vertical={false} stroke="var(--chart-grid)" />
            <XAxis dataKey="label" tick={chartTickStyle} />
            <YAxis tick={chartTickStyle} tickFormatter={compactUsd} />
            <Tooltip
              contentStyle={chartTooltipContentStyle}
              labelStyle={chartTooltipLabelStyle}
              itemStyle={chartTooltipItemStyle}
              formatter={(value) => formatUsd(Number(value))}
            />
            <Legend
              wrapperStyle={chartLegendWrapperStyle}
              itemSorter={(item) =>
                item.dataKey === "income"
                  ? 0
                  : item.dataKey === "expenses"
                    ? 1
                    : 2
              }
            />
            <Line
              type="monotone"
              dataKey="income"
              name="Income"
              stroke="var(--income)"
              strokeWidth={3}
              dot={{ r: 3 }}
              activeDot={{ r: 5 }}
              connectNulls
            />
            <Line
              type="monotone"
              dataKey="expenses"
              name="Expenses"
              stroke="var(--expense)"
              strokeWidth={3}
              strokeDasharray="1 7"
              strokeLinecap="round"
              dot={{ r: 4 }}
              activeDot={{ r: 6 }}
              connectNulls
            />
            <Line
              type="monotone"
              dataKey="savings"
              name="Available savings"
              stroke="var(--warning)"
              strokeWidth={3}
              strokeDasharray="1 7"
              strokeLinecap="round"
              dot={{ r: 4 }}
              activeDot={{ r: 6 }}
              connectNulls
            />
          </LineChart>
        </ResponsiveContainer>
      </div>
    </ChartCard>
  );
}

function ChartCard({
  title,
  description,
  children,
}: {
  title: string;
  description: string;
  children: React.ReactNode;
}) {
  return (
    <section className="panel analytics-card" aria-label={title}>
      <div className="section-heading compact">
        <div>
          <h3>{title}</h3>
          <p>{description}</p>
        </div>
      </div>
      {children}
    </section>
  );
}

function EmptyChart({ text }: { text: string }) {
  return <p className="empty-state analytics-empty">{text}</p>;
}

function categorySpending(overview: FinanceOverview): CategoryDatum[] {
  const categoryNames = new Map(
    overview.categories.map((item) => [item.category_id, item.name]),
  );
  const totals = new Map<string, number>();
  for (const entry of overview.transactions) {
    if (
      !entry.voided &&
      entry.direction === "expense" &&
      entry.occurred_on.startsWith(overview.summary.month)
    ) {
      totals.set(
        entry.category_id,
        (totals.get(entry.category_id) ?? 0) + entry.amount.minor_units,
      );
    }
  }
  return [...totals.entries()]
    .map(([categoryId, amount]) => ({
      categoryId,
      name: categoryNames.get(categoryId) ?? "Other",
      amount,
    }))
    .sort((left, right) => right.amount - left.amount);
}

function shortMonth(month: string): string {
  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    year: "2-digit",
    timeZone: "UTC",
  }).format(new Date(`${month}-01T00:00:00Z`));
}

function compactUsd(value: number): string {
  return new Intl.NumberFormat(undefined, {
    notation: "compact",
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  }).format(value / 100);
}

interface CategoryDatum {
  [key: string]: string | number;
  categoryId: string;
  name: string;
  amount: number;
}

interface MonthlyDatum {
  month: string;
  label: string;
  income: number;
  expenses: number;
  savings: number;
}
