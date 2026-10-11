import { useMemo, useState } from 'react'
import { useParams } from 'react-router'
import {
  BarChart,
  Bar,
  CartesianGrid,
  LineChart,
  Line,
  ResponsiveContainer,
  ScatterChart,
  Scatter,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import { BarChart3, CircleDollarSign, ListFilter, Package } from 'lucide-react'
import { usePreview } from '../app/preview'
import {
  Badge,
  DataTable,
  Empty,
  Notice,
  PageHeader,
  Panel,
  Stat,
} from '../components/ui'

const money = (value: number) =>
  new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    maximumFractionDigits: 0,
  }).format(value)
export default function Analytics() {
  const { fixture } = usePreview()
  const { id } = useParams()
  const sample = fixture && id === fixture.dataset.id ? fixture : null
  const [region, setRegion] = useState('All')
  const [chart, setChart] = useState('bar')
  const rows = useMemo(
    () =>
      sample?.rows.filter((row) => region === 'All' || row.region === region) ??
      [],
    [sample, region],
  )
  const total = rows.reduce((sum, row) => sum + Number(row.revenue), 0)
  const categories = ['Furniture', 'Technology', 'Office'].map((category) => ({
    category,
    revenue: rows
      .filter((row) => row.category === category)
      .reduce((sum, row) => sum + Number(row.revenue), 0),
  }))
  const monthly = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun'].map((month) => ({
    month,
    revenue: rows
      .filter((row) => row.month === month)
      .reduce((sum, row) => sum + Number(row.revenue), 0),
  }))
  return (
    <>
      <PageHeader
        eyebrow="PATTERNS WITH PROVENANCE"
        title="Analytics workspace"
        description="Look beyond the number. Keep the source in sight."
        actions={
          <Badge tone={sample ? 'copper' : 'neutral'}>
            {sample ? 'Retail operations · Sample v1' : 'No connected dataset'}
          </Badge>
        }
      />
      <Notice>
        {sample
          ? 'Synthetic sample visualization. Filters and totals use only the 12 local fixture rows, not backend analytics.'
          : 'Analytics connects in Phase 5. Open the sample workspace to explore chart interactions.'}
      </Notice>
      <div className="filter-bar">
        <span>
          <ListFilter size={17} />
          View controls
        </span>
        <label>
          Region
          <select
            value={region}
            disabled={!sample}
            onChange={(e) => setRegion(e.target.value)}
          >
            {['All', 'North', 'South', 'East', 'West'].map((value) => (
              <option key={value}>{value}</option>
            ))}
          </select>
        </label>
        <span className="filter-context">
          {sample
            ? `${rows.length} sample records · USD`
            : 'No source available'}
        </span>
        <button
          className="text-button"
          onClick={() => setRegion('All')}
          disabled={region === 'All'}
        >
          Reset filter
        </button>
      </div>
      <div className="stats-grid three">
        <Stat
          label="Revenue"
          value={sample ? money(total) : '—'}
          detail={
            sample
              ? 'Sum of filtered sample rows · USD'
              : 'Awaiting computed evidence'
          }
          icon={<CircleDollarSign size={19} />}
        />
        <Stat
          label="Order records"
          value={sample ? String(rows.length).padStart(2, '0') : '—'}
          detail={
            sample ? 'Count of filtered sample rows' : 'No dataset connected'
          }
          icon={<Package size={19} />}
        />
        <Stat
          label="Average order value"
          value={sample && rows.length ? money(total / rows.length) : '—'}
          detail={
            sample
              ? 'Sample revenue ÷ sample records'
              : 'No calculation performed'
          }
          icon={<BarChart3 size={19} />}
        />
      </div>
      {!sample ? (
        <Panel
          title="Your data, from another angle"
          subtitle="Charts will be grounded in approved computations"
        >
          <Empty title="Make room for a meaningful pattern.">
            Bar, line, scatter and distribution views will connect to
            evidence-backed analytics. No chart values are available yet.
          </Empty>
        </Panel>
      ) : (
        <>
          <div className="two-column">
            <Panel
              title="Revenue by category"
              subtitle="Sample aggregate · USD"
              action={
                <label className="compact-select">
                  <span className="sr-only">Category chart view</span>
                  <select
                    value={chart}
                    onChange={(e) => setChart(e.target.value)}
                  >
                    <option value="bar">Bar chart</option>
                    <option value="table">Data table</option>
                  </select>
                </label>
              }
            >
              {chart === 'bar' ? (
                <>
                  <div
                    className="chart-frame"
                    role="img"
                    aria-label={`Sample revenue by category: ${categories.map((row) => `${row.category} ${money(row.revenue)}`).join(', ')}. Exact values in the table below.`}
                  >
                    <ResponsiveContainer
                      width="100%"
                      height="100%"
                      minWidth={0}
                    >
                      <BarChart
                        data={categories}
                        margin={{ top: 18, right: 16, bottom: 8, left: 0 }}
                        accessibilityLayer
                      >
                        <CartesianGrid
                          vertical={false}
                          stroke="var(--border)"
                        />
                        <XAxis
                          dataKey="category"
                          tickLine={false}
                          axisLine={false}
                        />
                        <YAxis
                          tickFormatter={(value: number) => `${value / 1000}k`}
                          tickLine={false}
                          axisLine={false}
                          width={48}
                        />
                        <Tooltip
                          formatter={(value) => [
                            money(Number(value)),
                            'Revenue (USD)',
                          ]}
                        />
                        <Bar
                          dataKey="revenue"
                          fill="var(--teal)"
                          radius={[3, 3, 0, 0]}
                          maxBarSize={64}
                          isAnimationActive={false}
                        />
                      </BarChart>
                    </ResponsiveContainer>
                  </div>
                  <details>
                    <summary>View accessible chart data</summary>
                    <DataTable
                      rows={categories}
                      columns={[
                        { key: 'category', label: 'Category' },
                        { key: 'revenue', label: 'Revenue (USD)' },
                      ]}
                      caption="Sample category revenue"
                    />
                  </details>
                </>
              ) : (
                <DataTable
                  rows={categories}
                  columns={[
                    { key: 'category', label: 'Category' },
                    { key: 'revenue', label: 'Revenue (USD)' },
                  ]}
                  caption="Sample category revenue"
                />
              )}
            </Panel>
            <Panel
              title="The shape of revenue"
              subtitle="Monthly sample totals · USD"
            >
              <div
                className="chart-frame"
                role="img"
                aria-label="Synthetic monthly revenue from January to June. Exact values are available in the expandable table."
              >
                <ResponsiveContainer width="100%" height="100%" minWidth={0}>
                  <LineChart
                    data={monthly}
                    margin={{ top: 18, right: 20, bottom: 8, left: 0 }}
                    accessibilityLayer
                  >
                    <CartesianGrid vertical={false} stroke="var(--border)" />
                    <XAxis dataKey="month" tickLine={false} axisLine={false} />
                    <YAxis
                      tickFormatter={(value: number) => `${value / 1000}k`}
                      width={48}
                      tickLine={false}
                      axisLine={false}
                    />
                    <Tooltip
                      formatter={(value) => [
                        money(Number(value)),
                        'Revenue (USD)',
                      ]}
                    />
                    <Line
                      type="linear"
                      dataKey="revenue"
                      stroke="var(--copper-strong)"
                      strokeWidth={2.5}
                      dot={{ r: 4, fill: 'var(--surface)' }}
                      isAnimationActive={false}
                    />
                  </LineChart>
                </ResponsiveContainer>
              </div>
              <details>
                <summary>View accessible chart data</summary>
                <DataTable
                  rows={monthly}
                  columns={[
                    { key: 'month', label: 'Month' },
                    { key: 'revenue', label: 'Revenue (USD)' },
                  ]}
                  caption="Sample monthly revenue"
                />
              </details>
            </Panel>
          </div>
          <div className="two-column">
            <Panel
              title="Units & revenue"
              subtitle="Each point is a synthetic order"
            >
              <div
                className="chart-frame"
                role="img"
                aria-label="Scatter plot comparing units ordered to revenue in USD. The table below contains every point."
              >
                <ResponsiveContainer width="100%" height="100%" minWidth={0}>
                  <ScatterChart
                    margin={{ top: 16, right: 22, bottom: 20, left: 0 }}
                    accessibilityLayer
                  >
                    <CartesianGrid stroke="var(--border)" />
                    <XAxis
                      type="number"
                      dataKey="units"
                      name="Units"
                      unit=" units"
                      tickLine={false}
                    />
                    <YAxis
                      type="number"
                      dataKey="revenue"
                      name="Revenue"
                      unit=" USD"
                      width={70}
                      tickLine={false}
                    />
                    <Tooltip cursor={{ strokeDasharray: '3 3' }} />
                    <Scatter
                      data={rows}
                      fill="var(--teal)"
                      isAnimationActive={false}
                    />
                  </ScatterChart>
                </ResponsiveContainer>
              </div>
              <details>
                <summary>View accessible chart data</summary>
                <DataTable
                  rows={rows}
                  columns={[
                    { key: 'order', label: 'Order' },
                    { key: 'units', label: 'Units' },
                    { key: 'revenue', label: 'Revenue (USD)' },
                  ]}
                  caption="Sample scatter points"
                />
              </details>
            </Panel>
            <Panel
              title="Correlation & distribution"
              subtitle="Statistical checks come before interpretation"
            >
              <div
                className="matrix-placeholder"
                aria-label="Correlation matrix placeholder; no values calculated"
              >
                <span />
                <strong>Units</strong>
                <strong>Revenue</strong>
                <strong>Units</strong>
                <span>—</span>
                <span>—</span>
                <strong>Revenue</strong>
                <span>—</span>
                <span>—</span>
              </div>
              <p className="chart-note">
                No correlation coefficients or distribution estimates have been
                calculated. These panels connect to deterministic tools in Phase
                5.
              </p>
              <details>
                <summary>Read the methodology note</summary>
                <p>
                  A visual relationship does not establish causation. Missing
                  values, units, sample size and the chosen measure must be
                  reported with the result.
                </p>
              </details>
            </Panel>
          </div>
        </>
      )}
      <Panel
        title="Source & evidence"
        subtitle="A number is only useful when you know where it came from"
      >
        <div className="source-strip">
          <div>
            <span>Source</span>
            <strong>
              {sample
                ? 'Development fixture · Retail operations'
                : 'Not connected'}
            </strong>
          </div>
          <div>
            <span>Version</span>
            <strong>{sample ? 'Sample v1' : '—'}</strong>
          </div>
          <div>
            <span>Method</span>
            <strong>
              {sample ? 'Local sample sums and counts' : 'No computation'}
            </strong>
          </div>
          <div>
            <span>Stored evidence</span>
            <strong>None · Phase 5</strong>
          </div>
        </div>
      </Panel>
    </>
  )
}
