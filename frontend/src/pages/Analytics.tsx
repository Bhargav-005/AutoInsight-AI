import { useEffect, useMemo, useState } from 'react'
import { Link, useParams } from 'react-router'
import {
  Bar, BarChart, CartesianGrid, Line, LineChart, ResponsiveContainer,
  Scatter, ScatterChart, Tooltip, XAxis, YAxis,
} from 'recharts'
import { BarChart3, CircleAlert, Database, Rows3 } from 'lucide-react'
import { api, type AnalyticsRows, type AnalyticsSummary, type CorrelationResult, type DatasetSummary, type DatasetVersion } from '../api/client'
import { Badge, DataTable, Empty, Notice, PageHeader, Panel, Stat } from '../components/ui'
import type { DataRow } from '../types/domain'
import { isDatasetId } from '../app/datasetId'

type ChartType = 'bar' | 'line' | 'scatter' | 'histogram' | 'category'
const chartNames: Record<ChartType, string> = { bar: 'Bar', line: 'Line', scatter: 'Scatter', histogram: 'Histogram', category: 'Category distribution' }

export default function Analytics() {
  const { id = '' } = useParams()
  const validDatasetId = isDatasetId(id)
  const [dataset, setDataset] = useState<DatasetSummary | null>(null)
  const [versions, setVersions] = useState<DatasetVersion[]>([])
  const [versionId, setVersionId] = useState('')
  const [versionDatasetId, setVersionDatasetId] = useState('')
  const [summary, setSummary] = useState<AnalyticsSummary | null>(null)
  const [categoryColumn, setCategoryColumn] = useState('')
  const [groupBy, setGroupBy] = useState('')
  const [metric, setMetric] = useState('')
  const [aggregate, setAggregate] = useState<'count' | 'sum' | 'mean' | 'min' | 'max' | 'median'>('sum')
  const [grouped, setGrouped] = useState<AnalyticsRows | null>(null)
  const [chartType, setChartType] = useState<ChartType>('bar')
  const [chartX, setChartX] = useState('')
  const [chartY, setChartY] = useState('')
  const [chart, setChart] = useState<AnalyticsRows | null>(null)
  const [correlations, setCorrelations] = useState<CorrelationResult | null>(null)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    if (!validDatasetId) return
    const controller = new AbortController()
    setDataset(null)
    setVersions([])
    setVersionId('')
    setVersionDatasetId('')
    setSummary(null)
    setError('')
    Promise.all([
      api<DatasetSummary>(`/datasets/${id}`, { signal: controller.signal }),
      api<DatasetVersion[]>(`/datasets/${id}/versions`, { signal: controller.signal }),
    ]).then(([detail, history]) => {
      setDataset(detail)
      setVersions(history)
      setVersionDatasetId(id)
      setVersionId(history.at(-1)?.id ?? '')
    }).catch((reason: unknown) => {
      if (!controller.signal.aborted) setError(reason instanceof Error ? reason.message : 'Dataset unavailable.')
    })
    return () => controller.abort()
  }, [id, validDatasetId])

  useEffect(() => {
    if (!validDatasetId || versionDatasetId !== id || !versionId) return
    const controller = new AbortController()
    setLoading(true); setError(''); setGrouped(null); setChart(null); setCorrelations(null)
    api<AnalyticsSummary>(`/datasets/${id}/analytics/summary?version_id=${versionId}`, { signal: controller.signal })
      .then((result) => {
        setSummary(result)
        const numeric = result.columns.filter((item) => item.numeric)
        const suggestedMetric = numeric.find((item) => !/(^id$|_id$|index|identifier)/i.test(item.name)) ?? numeric[0]
        const category = result.columns.find((item) => !item.numeric)
        setCategoryColumn((current) => result.columns.some((item) => item.id === current && !item.numeric) ? current : category?.id ?? '')
        setMetric((current) => numeric.some((item) => item.id === current) ? current : suggestedMetric?.id ?? '')
        setGroupBy((current) => result.columns.some((item) => item.id === current) ? current : category?.id ?? result.columns[0]?.id ?? '')
        setChartX((current) => result.columns.some((item) => item.id === current) ? current : category?.id ?? numeric[0]?.id ?? '')
        setChartY((current) => numeric.some((item) => item.id === current) ? current : suggestedMetric?.id ?? '')
      }).catch((reason: unknown) => {
        if (!controller.signal.aborted) setError(reason instanceof Error ? reason.message : 'Analytics unavailable.')
      }).finally(() => { if (!controller.signal.aborted) setLoading(false) })
    return () => controller.abort()
  }, [id, validDatasetId, versionDatasetId, versionId])

  const numericColumns = useMemo(() => summary?.columns.filter((item) => item.numeric) ?? [], [summary])
  const label = (columnId: string) => summary?.columns.find((item) => item.id === columnId)?.name ?? columnId
  const runGrouped = async () => {
    if (!groupBy || (aggregate !== 'count' && !metric)) return
    setError('')
    try {
      setGrouped(await api<AnalyticsRows>(`/datasets/${id}/analytics/grouped`, {
        method: 'POST', body: { version_id: versionId, group_by: [groupBy], operation: aggregate, ...(aggregate === 'count' ? {} : { column: metric }) },
      }))
    } catch (reason) { setError(reason instanceof Error ? reason.message : 'Grouped analysis failed.') }
  }
  const runChart = async () => {
    if (!chartX || (['bar', 'line', 'scatter'].includes(chartType) && !chartY)) return
    setError('')
    try {
      setChart(await api<AnalyticsRows>(`/datasets/${id}/analytics/chart`, {
        method: 'POST', body: { version_id: versionId, chart_type: chartType, x: chartX, ...(['bar', 'line', 'scatter'].includes(chartType) ? { y: chartY } : {}) },
      }))
    } catch (reason) { setChart(null); setError(reason instanceof Error ? reason.message : 'Chart data unavailable.') }
  }
  const runCorrelation = async () => {
    setError('')
    try {
      setCorrelations(await api<CorrelationResult>(`/datasets/${id}/analytics/correlation`, {
        method: 'POST', body: { version_id: versionId, columns: numericColumns.slice(0, 20).map((item) => item.id) },
      }))
    } catch (reason) { setCorrelations(null); setError(reason instanceof Error ? reason.message : 'Correlation unavailable.') }
  }
  const chartRows = chart?.rows ?? []
  const numericChartRows = chartType === 'histogram'
    ? chartRows.map((row) => ({ label: `${row.start} – ${row.end}`, value: row.count }))
    : chartRows
  const tableColumns = grouped?.rows[0]
    ? Object.keys(grouped.rows[0]).map((key) => ({ key, label: key === 'value' ? `${aggregate} · ${label(metric)}` : label(key) }))
    : []

  if (!validDatasetId) {
    return <>
      <PageHeader eyebrow="PATTERNS WITH PROVENANCE" title="Choose a dataset" description="Open Analytics from a ready dataset in your library." />
      <Empty title="No dataset is selected">
        Select a ready dataset to calculate statistics and charts from stored data.
        <Link className="button" to="/datasets">Browse datasets</Link>
      </Empty>
    </>
  }

  return <>
    <PageHeader eyebrow="PATTERNS WITH PROVENANCE" title="Analytics workspace" description="Run bounded calculations over a selected immutable dataset version." actions={<Badge tone={dataset ? 'teal' : 'neutral'}>{dataset?.display_name ?? 'Dataset unavailable'}</Badge>} />
    {error && <Notice>{error}</Notice>}
    {!dataset ? <Panel title="Dataset source"><Empty title={error || 'Loading the selected dataset…'}>Open analytics from an owned dataset to calculate real results.</Empty></Panel> : <>
      <Notice>Every result below is calculated from stored data. Selected dataset: <strong>{dataset.original_filename}</strong>.</Notice>
      <div className="filter-bar">
        <label>Dataset version<select aria-label="Analytics dataset version" value={versionId} onChange={(event) => setVersionId(event.target.value)}>{versions.map((item) => <option key={item.id} value={item.id}>Version {item.version_no} · {item.kind}</option>)}</select></label>
        <span className="filter-context">{loading ? 'Calculating summary…' : summary ? `${summary.rows_analyzed.toLocaleString()} rows · ${summary.column_count} columns · exact` : 'No analysis loaded'}</span>
      </div>
      {summary && <>
        <div className="stats-grid three">
          <Stat label="Rows analyzed" value={summary.row_count.toLocaleString()} detail="All rows in the selected version" icon={<Rows3 size={18} />} />
          <Stat label="Columns" value={String(summary.column_count)} detail="Stored version columns" icon={<Database size={18} />} />
          <Stat label="Exact duplicates" value={String(summary.duplicate_rows)} detail="Calculated on selected version" icon={<CircleAlert size={18} />} />
        </div>
        <Panel title="Column summary" subtitle="Missing values, exact distinct counts, distributions and descriptive statistics">
          <div className="table-scroll" role="region" aria-label="Column statistics" tabIndex={0}><table><caption>Statistics for dataset version {versions.find((item) => item.id === versionId)?.version_no}</caption><thead><tr><th>Column</th><th>Type</th><th>Missing</th><th>Distinct</th><th>Mean</th><th>Median</th><th>Min</th><th>Max</th><th>Std dev</th></tr></thead><tbody>{summary.columns.map((item) => <tr key={item.id}><th scope="row">{item.name}</th><td>{item.numeric ? 'Numeric' : 'Categorical / text'}</td><td>{item.null_count} · {item.null_percent.toFixed(1)}%</td><td>{item.distinct_count}</td><td>{item.numeric?.mean.toPrecision(5) ?? '—'}</td><td>{item.numeric?.median.toPrecision(5) ?? '—'}</td><td>{item.numeric?.min.toPrecision(5) ?? '—'}</td><td>{item.numeric?.max.toPrecision(5) ?? '—'}</td><td>{item.numeric?.stddev?.toPrecision(5) ?? '—'}</td></tr>)}</tbody></table></div>
        </Panel>
        <Panel title="Category frequencies" subtitle="Top category counts are computed over all rows in the selected version">
          {summary.columns.some((item) => !item.numeric) ? <>
            <div className="filter-bar"><label>Category column<select aria-label="Frequency column" value={categoryColumn} onChange={(event) => setCategoryColumn(event.target.value)}>{summary.columns.filter((item) => !item.numeric).map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label></div>
            {(() => {
              const column = summary.columns.find((item) => item.id === categoryColumn)
              const rows = (column?.frequencies ?? []).map((item, index) => ({ id: String(index), value: item.value, count: item.count }))
              return <>
                {column?.frequency_warning && <p className="muted">{column.frequency_warning}</p>}
                <DataTable rows={rows} columns={[{ key: 'value', label: column?.name ?? 'Category' }, { key: 'count', label: 'Rows' }]} caption="Category frequencies" pageSize={8} />
              </>
            })()}
          </> : <Empty title="No categorical columns">Category frequencies are not available for this version.</Empty>}
        </Panel>
        <div className="two-column">
          <Panel title="Grouped analysis" subtitle="Aggregates are computed from underlying rows">
            <div className="filter-bar">
              <label>Group by<select aria-label="Group by column" value={groupBy} onChange={(event) => setGroupBy(event.target.value)}>{summary.columns.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
              <label>Operation<select aria-label="Aggregate operation" value={aggregate} onChange={(event) => setAggregate(event.target.value as typeof aggregate)}>{['count', 'sum', 'mean', 'min', 'max', 'median'].map((value) => <option value={value} key={value}>{value}</option>)}</select></label>
              {aggregate !== 'count' && <label>Numeric column<select aria-label="Aggregate metric" value={metric} onChange={(event) => setMetric(event.target.value)}>{numericColumns.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>}
              <button className="button secondary" onClick={runGrouped} disabled={!groupBy || (aggregate !== 'count' && !metric)}>Calculate</button>
            </div>
            {grouped ? <><p>{grouped.rows_analyzed.toLocaleString()} rows analyzed · {grouped.exact ? 'exact' : 'estimated'}</p><DataTable rows={grouped.rows as DataRow[]} columns={tableColumns} caption="Grouped aggregate results" pageSize={8} /></> : <Empty title="Choose a grouping and aggregate">The result table will contain real calculated values.</Empty>}
          </Panel>
          <Panel title="Chart-ready analysis" subtitle="At most 100 result points; no fictional data">
            <div className="filter-bar">
              <label>Chart<select aria-label="Chart type" value={chartType} onChange={(event) => { setChartType(event.target.value as ChartType); setChart(null) }}>{Object.entries(chartNames).map(([value, name]) => <option value={value} key={value}>{name}</option>)}</select></label>
              <label>{chartType === 'scatter' || chartType === 'histogram' ? 'X column' : 'Category / X column'}<select aria-label="Chart X column" value={chartX} onChange={(event) => setChartX(event.target.value)}>{summary.columns.filter((item) => chartType === 'histogram' || chartType === 'scatter' ? item.numeric : true).map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
              {['bar', 'line', 'scatter'].includes(chartType) && <label>{chartType === 'scatter' ? 'Y column' : 'Value column'}<select aria-label="Chart Y column" value={chartY} onChange={(event) => setChartY(event.target.value)}>{numericColumns.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>}
              <button className="button secondary" onClick={runChart} disabled={!chartX || (['bar', 'line', 'scatter'].includes(chartType) && !chartY)}>Build chart</button>
            </div>
            {chart ? <>
              {chart.warnings.map((warning) => <p className="muted" key={warning}>{warning}</p>)}
              <div className="chart-frame" role="img" aria-label={`${chartNames[chartType]} chart from ${chart.selected_columns.map(label).join(' and ')}; a data table follows`}>
                <ResponsiveContainer width="100%" height="100%" minWidth={0}>
                  {chartType === 'scatter' ? <ScatterChart accessibilityLayer><CartesianGrid stroke="var(--border)" /><XAxis type="number" dataKey={chartX} name={label(chartX)} /><YAxis type="number" dataKey={chartY} name={label(chartY)} /><Tooltip /><Scatter data={chartRows} fill="var(--teal)" isAnimationActive={false} /></ScatterChart> : chartType === 'line' ? <LineChart data={numericChartRows} accessibilityLayer><CartesianGrid vertical={false} stroke="var(--border)" /><XAxis dataKey="label" /><YAxis /><Tooltip /><Line dataKey="value" stroke="var(--copper-strong)" dot={false} isAnimationActive={false} /></LineChart> : <BarChart data={numericChartRows} accessibilityLayer><CartesianGrid vertical={false} stroke="var(--border)" /><XAxis dataKey={chartType === 'histogram' ? 'label' : 'label'} /><YAxis /><Tooltip /><Bar dataKey="value" fill="var(--teal)" isAnimationActive={false} /></BarChart>}
                </ResponsiveContainer>
              </div>
              <DataTable rows={numericChartRows as DataRow[]} columns={Object.keys(numericChartRows[0] ?? {}).map((key) => ({ key, label: key }))} caption="Chart data" pageSize={8} />
            </> : <Empty title="Choose a supported chart">The chart uses only the selected version's values and shows a message when the selected columns are unsuitable.</Empty>}
          </Panel>
        </div>
        <Panel title="Numeric correlation" subtitle="Pearson correlation with insufficient and constant columns reported">
          <button className="button secondary" disabled={numericColumns.length < 2} onClick={runCorrelation}><BarChart3 size={16} /> Calculate correlation</button>
          {numericColumns.length < 2 ? <p className="muted">At least two numeric columns are needed.</p> : null}
          {correlations && <><p>{correlations.rows_analyzed.toLocaleString()} rows analyzed · Pearson correlation</p>{correlations.warnings.map((warning) => <p className="muted" key={warning}>{warning}</p>)}<div className="table-scroll" role="region" aria-label="Correlation matrix" tabIndex={0}><table><caption>Correlation matrix</caption><thead><tr><th>Column</th>{correlations.columns.map((column) => <th key={column}>{label(column)}</th>)}</tr></thead><tbody>{correlations.matrix.map((row) => <tr key={row.column}><th scope="row">{label(row.column)}</th>{row.values.map((value, index) => <td key={`${row.column}-${index}`}>{value === null ? '—' : value.toFixed(3)}</td>)}</tr>)}</tbody></table></div></>}
        </Panel>
        <Panel title="Source and method" subtitle="Trace each result to its source">
          <div className="source-strip"><div><span>Dataset</span><strong>{dataset.original_filename}</strong></div><div><span>Version</span><strong>v{versions.find((item) => item.id === versionId)?.version_no ?? '—'}</strong></div><div><span>Rows analyzed</span><strong>{summary.rows_analyzed.toLocaleString()}</strong></div><div><span>Method</span><strong>Deterministic full-version computation</strong></div></div>
        </Panel>
      </>}
    </>}
  </>
}
