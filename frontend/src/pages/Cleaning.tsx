import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link, useParams } from 'react-router'
import { ArrowRight, Plus, RefreshCw, Trash2 } from 'lucide-react'
import {
  api,
  ApiError,
  type CleaningOperation,
  type CleaningPlan,
  type CleaningSuggestions,
  type DatasetProfile,
  type DatasetSummary,
  type DatasetVersion,
} from '../api/client'
import { Badge, DataTable, Empty, Notice, PageHeader, Panel, Stat } from '../components/ui'
import type { DataRow } from '../types/domain'
import { isDatasetId } from '../app/datasetId'

type Action = CleaningOperation['op']
const actionLabels: Record<Action, string> = {
  drop_duplicates: 'Remove exact duplicate rows',
  drop_missing_rows: 'Remove rows with missing values',
  fill_missing: 'Fill missing values',
  trim_whitespace: 'Trim text whitespace',
  replace_text: 'Replace text',
  cast_numeric: 'Convert to number',
}

export default function Cleaning() {
  const { id = '' } = useParams()
  const validDatasetId = isDatasetId(id)
  const [dataset, setDataset] = useState<DatasetSummary | null>(null)
  const [versions, setVersions] = useState<DatasetVersion[]>([])
  const [versionId, setVersionId] = useState('')
  const [versionDatasetId, setVersionDatasetId] = useState('')
  const [profile, setProfile] = useState<DatasetProfile | null>(null)
  const [suggestions, setSuggestions] = useState<CleaningSuggestions | null>(null)
  const [operations, setOperations] = useState<CleaningOperation[]>([])
  const [action, setAction] = useState<Action>('drop_duplicates')
  const [column, setColumn] = useState('')
  const [strategy, setStrategy] = useState<'mode' | 'mean' | 'median' | 'constant'>('mode')
  const [constant, setConstant] = useState('Unknown')
  const [find, setFind] = useState('')
  const [replace, setReplace] = useState('')
  const [plan, setPlan] = useState<CleaningPlan | null>(null)
  const [approved, setApproved] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [comparison, setComparison] = useState<Record<string, unknown> | null>(null)
  const [compareLeft, setCompareLeft] = useState('')
  const [compareRight, setCompareRight] = useState('')

  const loadVersions = useCallback(async () => {
    const [detail, history] = await Promise.all([
      api<DatasetSummary>(`/datasets/${id}`),
      api<DatasetVersion[]>(`/datasets/${id}/versions`),
    ])
    setDataset(detail)
    setVersions(history)
    return history
  }, [id])

  useEffect(() => {
    if (!validDatasetId) return
    const controller = new AbortController()
    setDataset(null)
    setVersions([])
    setVersionId('')
    setVersionDatasetId('')
    setProfile(null)
    setSuggestions(null)
    setPlan(null)
    setError('')
    Promise.all([
      api<DatasetSummary>(`/datasets/${id}`, { signal: controller.signal }),
      api<DatasetVersion[]>(`/datasets/${id}/versions`, { signal: controller.signal }),
    ]).then(([detail, history]) => {
      setDataset(detail)
      setVersions(history)
      setVersionDatasetId(id)
      setVersionId(history.at(-1)?.id || '')
      setCompareLeft((current) => current || history[0]?.id || '')
      setCompareRight((current) => current || history.at(-1)?.id || '')
    }).catch((reason: unknown) => {
      if (!controller.signal.aborted) setError(reason instanceof Error ? reason.message : 'Dataset unavailable.')
    })
    return () => controller.abort()
  }, [id, validDatasetId])

  useEffect(() => {
    if (!validDatasetId || versionDatasetId !== id || !versionId) return
    const controller = new AbortController()
    Promise.all([
      api<DatasetProfile>(`/datasets/${id}/profile?version_id=${versionId}`, { signal: controller.signal }),
      api<CleaningSuggestions>(`/datasets/${id}/versions/${versionId}/cleaning/suggestions`, { signal: controller.signal }),
    ]).then(([currentProfile, currentSuggestions]) => {
      setProfile(currentProfile)
      setSuggestions(currentSuggestions)
      setOperations([])
      setApproved(false)
      setComparison(null)
    }).catch((reason: unknown) => {
      if (!controller.signal.aborted) setError(reason instanceof Error ? reason.message : 'Profile unavailable.')
    })
    return () => controller.abort()
  }, [id, validDatasetId, versionDatasetId, versionId])

  useEffect(() => {
    if (!validDatasetId || !plan || !['queued', 'running'].includes(plan.state)) return
    const timer = window.setTimeout(() => {
      api<CleaningPlan>(`/cleaning/plans/${plan.id}`).then(async (next) => {
        setPlan(next)
        if (next.state === 'completed' && next.result_version_id) {
          const history = await loadVersions()
          setVersionId(next.result_version_id)
          setCompareRight(history.at(-1)?.id ?? next.result_version_id)
        }
        if (next.state === 'failed') setError(next.error_message || 'Cleaning failed safely.')
      }).catch((reason: unknown) => setError(reason instanceof Error ? reason.message : 'Unable to read job status.'))
    }, 900)
    return () => window.clearTimeout(timer)
  }, [plan, id, loadVersions, validDatasetId])

  const availableColumns = useMemo(() => profile?.columns ?? [], [profile])
  const selectedColumn = availableColumns.find((item) => item.id === column)
  const selectedColumnIsNumeric = selectedColumn?.data_type === 'number' || selectedColumn?.data_type === 'integer'
  if (!validDatasetId) {
    return (
      <>
        <PageHeader eyebrow="PREPARE WITH INTENT" title="Choose a dataset" description="Open Cleaning Studio from a ready dataset in your library." />
        <Empty title="No dataset is selected">
          Select a ready dataset to preview and apply cleaning operations.
          <Link className="button" to="/datasets">Browse datasets</Link>
        </Empty>
      </>
    )
  }
  const addOperation = () => {
    if (action === 'drop_duplicates') {
      setOperations((items) => [...items, { op: action }])
      return
    }
    if (action === 'drop_missing_rows') {
      setOperations((items) => [...items, { op: action, ...(column ? { columns: [column] } : {}) }])
      return
    }
    if (!column) return
    const operation: CleaningOperation = action === 'fill_missing'
      ? { op: action, column, strategy, ...(strategy === 'constant' ? { value: constant } : {}) }
      : action === 'replace_text'
        ? { op: action, column, find, replace }
        : action === 'cast_numeric'
          ? { op: action, column, invalid: 'error' }
          : { op: action, column }
    setOperations((items) => [...items, operation])
  }

  const previewPlan = async () => {
    if (!versionId || operations.length === 0) return
    setBusy(true); setError(''); setApproved(false)
    try {
      const created = await api<CleaningPlan>(`/datasets/${id}/cleaning/plans`, {
        method: 'POST', body: { dataset_version_id: versionId, operations },
      })
      const previewed = await api<CleaningPlan>(`/cleaning/plans/${created.id}/preview`, {
        method: 'POST', body: {},
      })
      setPlan(previewed)
    } catch (reason) {
      setError(reason instanceof ApiError ? reason.message : 'Could not preview this plan.')
    } finally { setBusy(false) }
  }

  const applyPlan = async () => {
    if (!plan || !approved) return
    setBusy(true); setError('')
    try {
      setPlan(await api<CleaningPlan>(`/cleaning/plans/${plan.id}/approve`, {
        method: 'POST', body: { confirm_apply: true },
      }))
    } catch (reason) {
      setError(reason instanceof ApiError ? reason.message : 'Could not queue this approved plan.')
    } finally { setBusy(false) }
  }

  const compareVersions = async () => {
    if (!compareLeft || !compareRight) return
    setError('')
    try {
      setComparison(await api<Record<string, unknown>>(
        `/datasets/${id}/compare?left_version_id=${compareLeft}&right_version_id=${compareRight}`,
      ))
    } catch (reason) { setError(reason instanceof Error ? reason.message : 'Comparison unavailable.') }
  }

  return <>
    <PageHeader eyebrow="PREPARE WITH INTENT" title="Cleaning Studio" description="Review the issues. Understand the change. Keep every source version." actions={<Badge tone="neutral">Owner data · Explicit approval</Badge>} />
    {error && <Notice>{error}</Notice>}
    {!dataset ? <Panel title="Dataset source"><Empty title={error || 'Loading the selected dataset…'}>Choose an owned dataset to create a cleaning plan.</Empty></Panel> : <>
      <Notice><strong>{dataset.display_name}</strong> · {dataset.original_filename} · Selected source version {versions.find((item) => item.id === versionId)?.version_no ?? '—'}. Suggestions and previews never change this version.</Notice>
      <div className="stats-grid three">
        <Stat label="Missing values" value={profile ? String(profile.quality_summary.missing_cell_count) : '—'} detail={profile ? `${profile.quality_summary.missing_cell_percent}% of cells · exact profile` : 'Loading selected version profile'} icon={<span aria-hidden="true">∅</span>} />
        <Stat label="Duplicate records" value={profile ? String(profile.duplicate_row_count) : '—'} detail={profile ? 'Exact duplicate rows' : 'Loading selected version profile'} icon={<span aria-hidden="true">↻</span>} />
        <Stat label="Source dimensions" value={profile ? `${profile.row_count} × ${profile.column_count}` : '—'} detail="Rows by columns in selected version" icon={<span aria-hidden="true">▦</span>} />
      </div>
      <div className="two-column cleaning-layout">
        <Panel title="Build a cleaning plan" subtitle="Operations run only after preview and explicit approval" action={<label className="compact-select"><span>Version</span><select aria-label="Cleaning source version" value={versionId} onChange={(event) => { setVersionId(event.target.value); setPlan(null) }}>{versions.map((item) => <option key={item.id} value={item.id}>Version {item.version_no} · {item.kind}</option>)}</select></label>}>
          {suggestions?.operations.length ? <div className="button-row"><span>{suggestions.operations.length} profile-based suggestion{suggestions.operations.length === 1 ? '' : 's'}</span><button className="button secondary" onClick={() => setOperations(suggestions.operations)}>Use suggestions</button></div> : <p className="muted">No automatic cleaning suggestions for this version.</p>}
          <div className="filter-bar">
            <label>Operation<select aria-label="Cleaning operation" value={action} onChange={(event) => setAction(event.target.value as Action)}>{Object.entries(actionLabels).map(([value, label]) => <option value={value} key={value}>{label}</option>)}</select></label>
            {action !== 'drop_duplicates' && <label>Column<select aria-label="Cleaning column" value={column} onChange={(event) => setColumn(event.target.value)}><option value="">Choose a column</option>{availableColumns.map((item) => <option value={item.id} key={item.id}>{item.name} · {item.data_type}</option>)}</select></label>}
            {action === 'fill_missing' && <label>Fill method<select aria-label="Fill method" value={strategy} onChange={(event) => setStrategy(event.target.value as typeof strategy)}><option value="mode">Most frequent value</option><option value="mean" disabled={!selectedColumnIsNumeric}>Numeric mean</option><option value="median" disabled={!selectedColumnIsNumeric}>Numeric median</option><option value="constant">Constant</option></select></label>}
            {action === 'fill_missing' && strategy === 'constant' && <label>Replacement value<input aria-label="Replacement value" value={constant} maxLength={200} onChange={(event) => setConstant(event.target.value)} /></label>}
            {action === 'replace_text' && <><label>Find<input aria-label="Text to find" value={find} maxLength={200} onChange={(event) => setFind(event.target.value)} /></label><label>Replace with<input aria-label="Replacement text" value={replace} maxLength={200} onChange={(event) => setReplace(event.target.value)} /></label></>}
            <button className="button secondary" onClick={addOperation} disabled={action !== 'drop_duplicates' && !column}><Plus size={16} /> Add operation</button>
          </div>
          {operations.length ? <ol className="clean-operation-list">{operations.map((item, index) => <li key={`${item.op}-${index}`}><span>{index + 1}. {actionLabels[item.op]}{item.column ? ` · ${availableColumns.find((col) => col.id === item.column)?.name ?? item.column}` : ''}{item.strategy ? ` · ${item.strategy}` : ''}</span><button className="icon-button" aria-label={`Remove operation ${index + 1}`} onClick={() => setOperations((items) => items.filter((_, at) => at !== index))}><Trash2 size={16} /></button></li>)}</ol> : <Empty title="No operations selected">Build a plan or add profile suggestions to continue.</Empty>}
          <button className="button" disabled={busy || !operations.length || !profile} onClick={previewPlan}>{busy ? 'Preparing preview…' : 'Preview plan'}</button>
        </Panel>
        <Panel title="Before and after preview" subtitle="A read-only calculation over the selected immutable source">
          {!plan?.preview ? <Empty title="Preview before approval">The source file and version history remain untouched until an approved job completes.</Empty> : <>
            <div className="stats-grid three"><Stat label="Rows" value={`${plan.preview.source_rows} → ${plan.preview.result_rows}`} detail={`${plan.preview.rows_removed} removed`} icon={<span>↕</span>} /><Stat label="Missing cells" value={`${plan.preview.source_missing_cells} → ${plan.preview.result_missing_cells}`} detail="Calculated across all source rows" icon={<span>∅</span>} /><Stat label="Duplicates" value={`${plan.preview.source_duplicate_rows} → ${plan.preview.result_duplicate_rows}`} detail="Exact row matches" icon={<span>↻</span>} /></div>
            <div className="comparison"><div><Badge>Before</Badge><DataTable rows={plan.preview.before as DataRow[]} columns={availableColumns.map((item) => ({ key: item.id, label: item.name }))} caption="Before preview" pageSize={5} /></div><ArrowRight aria-hidden="true" /><div><Badge tone="teal">Proposed after</Badge><DataTable rows={plan.preview.after as DataRow[]} columns={availableColumns.map((item) => ({ key: item.id, label: item.name }))} caption="After preview" pageSize={5} /></div></div>
            {plan.preview.warnings.map((warning) => <p className="muted" key={warning}>{warning}</p>)}
            <label className="approval-check"><input type="checkbox" checked={approved} onChange={(event) => setApproved(event.target.checked)} /><span>I reviewed this preview and approve creation of a new cleaned version.</span></label>
            <button className="button" disabled={busy || !approved || plan.state !== 'previewed'} onClick={applyPlan}>{plan.state === 'queued' || plan.state === 'running' ? 'Cleaning in progress…' : 'Approve and apply plan'}</button>
          </>}
          {plan?.state && <p role="status" className="inline-status">Plan state: <strong>{plan.state}</strong>{plan.result_version_id ? ` · created version ${versions.find((item) => item.id === plan.result_version_id)?.version_no ?? ''}` : ''}</p>}
          {plan?.state === 'failed' && <button className="button secondary" onClick={() => api<CleaningPlan>(`/cleaning/plans/${plan.id}/retry`, { method: 'POST', body: {} }).then(setPlan).catch((reason: unknown) => setError(reason instanceof Error ? reason.message : 'Retry failed.'))}><RefreshCw size={16} /> Retry approved job</button>}
        </Panel>
      </div>
      <Panel title="Immutable version history" subtitle="Each result references its source version; artifacts are never overwritten">
        <ol className="clean-version-list">{versions.map((item) => <li key={item.id}><span>Version {item.version_no} · {item.kind}</span><code>{item.checksum.slice(0, 12)}…</code><Badge>{item.mime_type === 'text/csv' ? 'CSV' : 'XLSX'}</Badge><button className="text-button" onClick={() => setVersionId(item.id)}>Select this source</button></li>)}</ol>
        {versions.length > 1 && <div className="filter-bar"><label>Compare version<select aria-label="Compare first version" value={compareLeft} onChange={(event) => setCompareLeft(event.target.value)}>{versions.map((item) => <option key={item.id} value={item.id}>Version {item.version_no}</option>)}</select></label><label>With version<select aria-label="Compare second version" value={compareRight} onChange={(event) => setCompareRight(event.target.value)}>{versions.map((item) => <option key={item.id} value={item.id}>Version {item.version_no}</option>)}</select></label><button className="button secondary" onClick={compareVersions}>Compare versions</button></div>}
        {comparison && <pre className="comparison-result">{JSON.stringify(comparison, null, 2)}</pre>}
      </Panel>
    </>}
  </>
}
