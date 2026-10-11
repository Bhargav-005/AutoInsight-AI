import { useEffect, useState } from 'react'
import { Link, useParams } from 'react-router'
import { ResponsiveContainer, Scatter, ScatterChart, CartesianGrid, XAxis, YAxis, Tooltip } from 'recharts'
import { api, ApiError, type DatasetSummary, type DatasetVersion } from '../api/client'
import type { MLMetadata, MLPrediction, MLRun, MLTask } from '../api/ml'
import { isDatasetId } from '../app/datasetId'
import { Badge, DataTable, Empty, Notice, PageHeader, Panel } from '../components/ui'

const names: Record<string, string> = {
  logistic_regression: 'Logistic Regression', random_forest_classifier: 'Random Forest Classifier',
  ridge: 'Ridge Regression', random_forest_regressor: 'Random Forest Regressor',
}
const metric = (value: number | null | undefined) => value == null ? 'Undefined' : value.toLocaleString(undefined, { maximumFractionDigits: 5 })
const message = (error: unknown) => error instanceof Error ? error.message : 'ML service is unavailable.'

const mlMessage = (error: unknown) => error instanceof ApiError && error.status === 404 && error.code === 'NOT_FOUND'
  ? 'The running API does not provide the ML endpoints. Restart the AutoInsight API, then reload this page.'
  : message(error)

export default function Models() {
  const { id = '' } = useParams()
  const validId = isDatasetId(id)
  const [dataset, setDataset] = useState<DatasetSummary | null>(null)
  const [versions, setVersions] = useState<DatasetVersion[]>([])
  const [version, setVersion] = useState('')
  const [sourceDatasetId, setSourceDatasetId] = useState('')
  const [metadataError, setMetadataError] = useState('')
  const [historyError, setHistoryError] = useState('')
  const [historyLoading, setHistoryLoading] = useState(false)
  const [metadata, setMetadata] = useState<MLMetadata | null>(null)
  const [target, setTarget] = useState('')
  const [features, setFeatures] = useState<string[]>([])
  const [task, setTask] = useState<MLTask>('classification')
  const [algorithm, setAlgorithm] = useState('logistic_regression')
  const [testSize, setTestSize] = useState(0.2)
  const [seed, setSeed] = useState(42)
  const [regularization, setRegularization] = useState(1)
  const [trees, setTrees] = useState(100)
  const [depth, setDepth] = useState(10)
  const [independent, setIndependent] = useState(false)
  const [runs, setRuns] = useState<MLRun[]>([])
  const [selected, setSelected] = useState<MLRun | null>(null)
  const [compareIds, setCompareIds] = useState<string[]>([])
  const [comparison, setComparison] = useState<MLRun[]>([])
  const [values, setValues] = useState<Record<string, string>>({})
  const [predictions, setPredictions] = useState<MLPrediction[]>([])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const evaluation = selected?.evaluation

  useEffect(() => {
    const controller = new AbortController()
    setDataset(null); setVersions([]); setVersion(''); setSourceDatasetId(''); setMetadata(null)
    setMetadataError(''); setHistoryError(''); setHistoryLoading(false); setTarget(''); setFeatures([])
    setRuns([]); setSelected(null); setError(''); setCompareIds([]); setComparison([]); setIndependent(false)
    if (!validId) return () => controller.abort()
    Promise.all([
      api<DatasetSummary>(`/datasets/${id}`, { signal: controller.signal }),
      api<DatasetVersion[]>(`/datasets/${id}/versions`, { signal: controller.signal }),
    ]).then(([detail, history]) => {
      if (controller.signal.aborted) return
      setDataset(detail); setVersions(history); setSourceDatasetId(id); setVersion(history.at(-1)?.id ?? '')
    }).catch((reason: unknown) => { if (!controller.signal.aborted) setError(message(reason)) })
    setHistoryLoading(true)
    api<MLRun[]>(`/ml-runs?dataset_id=${id}`, { signal: controller.signal }).then((experiments) => {
      if (controller.signal.aborted) return
      setRuns(experiments); setSelected(experiments[0] ?? null)
    }).catch((reason: unknown) => { if (!controller.signal.aborted) setHistoryError(mlMessage(reason)) })
      .finally(() => { if (!controller.signal.aborted) setHistoryLoading(false) })
    return () => controller.abort()
  }, [id, validId])

  useEffect(() => {
    setMetadata(null); setMetadataError(''); setTarget(''); setFeatures([]); setIndependent(false)
    if (!validId || sourceDatasetId !== id || !version || !versions.some((item) => item.id === version)) return
    const controller = new AbortController()
    api<MLMetadata>(`/datasets/${id}/versions/${version}/ml`, { signal: controller.signal }).then((data) => {
      if (controller.signal.aborted) return
      setMetadata(data)
      setFeatures(data.columns.filter((col) => !col.identifier && !['datetime', 'empty'].includes(col.data_type)).map((col) => col.id).slice(0, 30))
    }).catch((reason: unknown) => { if (!controller.signal.aborted) setMetadataError(mlMessage(reason)) })
    return () => controller.abort()
  }, [id, validId, version, versions, sourceDatasetId])

  useEffect(() => {
    if (!validId || sourceDatasetId !== id || !runs.some((run) => ['queued', 'running'].includes(run.status))) return
    const controller = new AbortController()
    const timer = window.setTimeout(() => {
      api<MLRun[]>(`/ml-runs?dataset_id=${id}`, { signal: controller.signal }).then((next) => {
        setRuns(next)
        setSelected((current) => next.find((run) => run.id === current?.id) ?? current)
      }).catch((reason: unknown) => { if (!controller.signal.aborted) setError(message(reason)) })
    }, 1500)
    return () => { window.clearTimeout(timer); controller.abort() }
  }, [id, validId, runs, sourceDatasetId])

  useEffect(() => {
    setValues({}); setPredictions([])
    if (!selected?.model_available) return
    const controller = new AbortController()
    api<MLPrediction[]>(`/ml-runs/${selected.id}/predictions`, { signal: controller.signal }).then(setPredictions)
      .catch((reason: unknown) => { if (!controller.signal.aborted) setError(message(reason)) })
    return () => controller.abort()
  }, [selected?.id, selected?.model_available])

  async function startTraining(event: React.FormEvent) {
    event.preventDefault(); setBusy(true); setError('')
    try {
      const run = await api<MLRun>('/ml-runs', { method: 'POST', body: {
        dataset_id: id, dataset_version_id: version, task_type: task, target_column: target,
        feature_columns: features.filter((key) => key !== target), algorithm, test_size: testSize,
        random_seed: seed, regularization, n_estimators: trees, max_depth: depth, independent_rows: independent,
      } })
      setRuns((current) => [run, ...current]); setSelected(run)
    } catch (reason) { setError(message(reason)) } finally { setBusy(false) }
  }

  async function predict(event: React.FormEvent) {
    event.preventDefault()
    if (!selected || !evaluation) return
    setBusy(true); setError('')
    try {
      const inputs = Object.fromEntries(evaluation.inputs.map((col) => {
        const value = values[col.id]?.trim() ?? ''
        return [col.id, value === '' ? null : ['number', 'integer'].includes(col.data_type) ? Number(value) : value]
      }))
      const prediction = await api<MLPrediction>(`/ml-runs/${selected.id}/predict`, { method: 'POST', body: { values: inputs } })
      setPredictions((current) => [prediction, ...current].slice(0, 50))
    } catch (reason) { setError(message(reason)) } finally { setBusy(false) }
  }

  async function compare() {
    setBusy(true); setError('')
    try { setComparison(await api<MLRun[]>('/ml-runs/compare', { method: 'POST', body: { run_ids: compareIds } })) }
    catch (reason) { setError(message(reason)) } finally { setBusy(false) }
  }

  if (!validId) return <><PageHeader eyebrow="MODEL WITH EVIDENCE" title="ML Studio" description="Train and evaluate models on your own dataset versions." /><Empty title="Choose a dataset">Choose an owned, ready dataset using the Dataset context selector above.<Link className="button" to="/datasets">Browse datasets</Link></Empty></>
  return <>
    <PageHeader eyebrow="MODEL WITH EVIDENCE" title="ML Studio" description="Real supervised learning, held-out evaluation and saved experiments." actions={<Badge>CPU training · Owner data</Badge>} />
    {error && <Notice>{error}</Notice>}
    {!dataset ? <Empty title={error ? 'Dataset unavailable' : 'Loading ML workspace…'}>The dataset and its experiments must be available before training.</Empty> : <>
      <Notice><strong>{dataset.display_name}</strong> · Training reads an immutable source version. Results are estimates from a random holdout, not guarantees.</Notice>
      <div className="two-column ml-workspace">
        <Panel title="Training configuration" subtitle="Choose a target explicitly and confirm the evaluation assumptions">
          <form onSubmit={startTraining}>
            <label>Dataset version<select aria-label="ML dataset version" value={version} onChange={(event) => setVersion(event.target.value)}>{versions.map((item) => <option key={item.id} value={item.id}>Version {item.version_no} · {item.kind}</option>)}</select></label>
            {!metadata ? metadataError ? <Notice>{metadataError}</Notice> : !version ? <p>No ready dataset versions are available yet.</p> : <p role="status">Loading version metadata…</p> : <>
              <p>{metadata.row_count.toLocaleString()} rows · Minimum 50 labeled rows</p>
              <label>Target column<select aria-label="Target column" required value={target} onChange={(event) => { setTarget(event.target.value); setFeatures((current) => current.filter((key) => key !== event.target.value)) }}><option value="">Choose a target</option>{metadata.columns.map((col) => <option key={col.id} value={col.id}>{col.name} · {col.data_type}</option>)}</select></label>
              <label>Learning task<select aria-label="Learning task" value={task} onChange={(event) => { const next = event.target.value as MLTask; setTask(next); setAlgorithm(next === 'classification' ? 'logistic_regression' : 'ridge') }}><option value="classification">Classification</option><option value="regression">Regression</option></select></label>
              <label>Model algorithm<select aria-label="Model algorithm" value={algorithm} onChange={(event) => setAlgorithm(event.target.value)}>{metadata.algorithms[task].map((item) => <option value={item} key={item}>{names[item]}</option>)}</select></label>
              <fieldset className="ml-features"><legend>Feature columns ({features.filter((key) => key !== target).length}/30)</legend>{metadata.columns.filter((col) => col.id !== target).map((col) => <label className="approval-check" key={col.id}><input type="checkbox" checked={features.includes(col.id)} disabled={['datetime', 'empty'].includes(col.data_type) || (!features.includes(col.id) && features.length >= 30)} onChange={(event) => setFeatures((current) => event.target.checked ? [...current, col.id] : current.filter((key) => key !== col.id))} /><span>{col.name} · {col.data_type}{col.identifier ? ' · Identifier: excluded by default' : ''}{col.missing_percent > 40 ? ' · Many missing values' : ''}</span></label>)}</fieldset>
              <div className="filter-bar">
                <label>Held-out fraction<select value={testSize} onChange={(event) => setTestSize(Number(event.target.value))}><option value={0.2}>20% test / 80% train</option><option value={0.3}>30% test / 70% train</option><option value={0.4}>40% test / 60% train</option></select></label>
                <label>Random seed<input type="number" min={0} max={2147483647} required value={seed} onChange={(event) => setSeed(Number(event.target.value))} /></label>
              </div>
              {algorithm.startsWith('random_forest') ? <div className="filter-bar"><label>Trees<input type="number" min={20} max={200} required value={trees} onChange={(event) => setTrees(Number(event.target.value))} /></label><label>Maximum depth<input type="number" min={2} max={16} required value={depth} onChange={(event) => setDepth(Number(event.target.value))} /></label></div> : <label>{algorithm === 'ridge' ? 'Ridge alpha' : 'Logistic inverse regularization (C)'}<input type="number" min={0.01} max={100} step={0.01} required value={regularization} onChange={(event) => setRegularization(Number(event.target.value))} /></label>}
              <details><summary>Training limits and data suitability</summary>{metadata.warnings.map((warning) => <p key={warning}>{warning}</p>)}<p>Median numeric imputation, most-frequent categorical imputation, scaling and encoding are fitted on training rows only. Each training attempt has a 10-minute maximum.</p></details>
              <label className="approval-check"><input type="checkbox" checked={independent} onChange={(event) => setIndependent(event.target.checked)} /><span>I confirm these rows can be evaluated independently, and selected features are available before the target is known. This is not a time-series or grouped prediction task.</span></label>
              <button className="button" disabled={busy || !target || !features.length || !independent || metadata.row_count < 50}>Start Training</button>
              {metadata.row_count < 50 && <p className="field-error">This dataset is too small for reliable held-out evaluation. Upload at least 50 labeled rows.</p>}
            </>}
          </form>
        </Panel>
        <Panel title="Saved experiments" subtitle="Latest 50 experiments for this dataset, across raw and cleaned versions">
          {historyError ? <Notice>{historyError}</Notice> : historyLoading ? <p role="status">Loading experiment history…</p> : !runs.length ? <Empty title="No experiments yet">Choose a target and start training to produce real results.</Empty> : <ul className="clean-version-list">{runs.map((run) => <li key={run.id}><div><button className="text-button" aria-pressed={selected?.id === run.id} onClick={() => { setSelected(run); setError('') }}>{names[run.config.algorithm]} · {run.id.slice(0, 8)}</button><p className="muted">Version {versions.find((item) => item.id === run.dataset_version_id)?.version_no ?? '—'} · {run.task_type} · {new Date(run.created_at).toLocaleString()}</p></div><Badge>{run.status}</Badge>{run.status === 'completed' && <label className="approval-check"><input type="checkbox" checked={compareIds.includes(run.id)} disabled={!compareIds.includes(run.id) && compareIds.length >= 5} onChange={(event) => { setComparison([]); setCompareIds((current) => event.target.checked ? [...current, run.id] : current.filter((key) => key !== run.id)) }} /><span>Compare {run.id.slice(0, 8)}</span></label>}</li>)}</ul>}
          <button className="button secondary" disabled={busy || compareIds.length < 2} onClick={compare}>Compare selected experiments</button>
          <p className="muted">Comparisons require the same version, target, task and held-out split.</p>
          {selected && <><p role="status">Training status: <strong>{selected.status}</strong> · Attempt {selected.attempt_count}</p>{selected.error_message && <Notice>{selected.error_message}</Notice>}{selected.status === 'failed' && selected.attempt_count < 3 && <button className="button secondary" disabled={busy} onClick={async () => {
            setBusy(true); setError('')
            try { const next = await api<MLRun>(`/ml-runs/${selected.id}/retry`, { method: 'POST', body: {} }); setSelected(next); setRuns((current) => current.map((item) => item.id === next.id ? next : item)) }
            catch (reason) { setError(message(reason)) } finally { setBusy(false) }
          }}>Retry training</button>}</>}
        </Panel>
      </div>
      {comparison.length > 0 && <Panel title="Compatible experiment comparison"><DataTable caption="Experiment comparison" rows={comparison.map((run) => ({ id: run.id.slice(0, 8), algorithm: names[run.config.algorithm], ...run.evaluation?.metrics }))} columns={[{ key: 'id', label: 'Experiment' }, { key: 'algorithm', label: 'Model' }, ...Object.keys(comparison[0].evaluation?.metrics ?? {}).map((key) => ({ key, label: key.replaceAll('_', ' ') }))]} /></Panel>}
      {evaluation && selected && <>
        <Panel title="Held-out evaluation" subtitle={`${names[selected.config.algorithm]} · ${evaluation.train_rows} train / ${evaluation.test_rows} test rows · ${selected.id.slice(0, 8)}`}>
          <p>Target: {metadata?.columns.find((col) => col.id === selected.target_column)?.name ?? selected.target_column} · Source version {versions.find((item) => item.id === selected.dataset_version_id)?.version_no ?? '—'} · Seed {selected.config.random_seed}</p>
          <DataTable caption="Held-out metrics and baseline" rows={Object.entries(evaluation.metrics).map(([key, value]) => ({ metric: key.replaceAll('_', ' '), model: metric(value), baseline: metric(evaluation.baseline[key]) }))} columns={[{ key: 'metric', label: 'Metric' }, { key: 'model', label: 'Held-out model' }, { key: 'baseline', label: 'Dummy baseline (same split)' }]} />
          {evaluation.warnings.map((warning) => <p className="warning-note" key={warning}>{warning}</p>)}
          {selected.task_type === 'classification' ? <>
            <p className="muted">{evaluation.roc_auc_method}</p>
            <DataTable caption="Confusion matrix — actual rows, predicted columns" rows={evaluation.confusion_matrix.map((row, index) => Object.fromEntries([['actual', evaluation.classes[index]], ...row.map((value, col) => [`class_${col}`, value])]))} columns={[{ key: 'actual', label: 'Actual / Predicted' }, ...evaluation.classes.map((label, index) => ({ key: `class_${index}`, label }))]} />
            <DataTable caption="Class support" rows={evaluation.class_distribution} columns={[{ key: 'label', label: 'Class' }, { key: 'train', label: 'Training support' }, { key: 'test', label: 'Test support' }]} />
          </> : <>
            <p className="muted">Charts and table show the first 200 held-out predictions. Metrics and residual summaries use the full test set.</p>
            <div className="two-column ml-workspace"><div role="img" aria-label="Actual versus predicted values. Data is available in the following table."><ResponsiveContainer width="100%" height={260}><ScatterChart><CartesianGrid strokeDasharray="3 3" /><XAxis dataKey="actual" type="number" name="Actual" /><YAxis dataKey="predicted" type="number" name="Predicted" /><Tooltip /><Scatter data={evaluation.actual_predicted} fill="#3d7770" isAnimationActive={false} /></ScatterChart></ResponsiveContainer></div><div role="img" aria-label="Residuals versus predicted values. Data is available in the following table."><ResponsiveContainer width="100%" height={260}><ScatterChart><CartesianGrid strokeDasharray="3 3" /><XAxis dataKey="predicted" type="number" name="Predicted" /><YAxis dataKey="residual" type="number" name="Residual" /><Tooltip /><Scatter data={evaluation.actual_predicted} fill="#a66b45" isAnimationActive={false} /></ScatterChart></ResponsiveContainer></div></div>
            <DataTable caption="Actual, predicted and residual values" rows={evaluation.actual_predicted} columns={[{ key: 'actual', label: 'Actual' }, { key: 'predicted', label: 'Predicted' }, { key: 'residual', label: 'Residual' }]} />
            <p>Residual mean: {metric(evaluation.residual_summary.mean)} · Standard deviation: {metric(evaluation.residual_summary.stddev)} · Range: {metric(evaluation.residual_summary.min)} to {metric(evaluation.residual_summary.max)}</p>
          </>}
        </Panel>
        <Panel title="Feature explanation" subtitle={evaluation.explanation.method}><p>{evaluation.explanation.limitation}</p><DataTable caption="Feature importance" rows={evaluation.explanation.features} columns={[{ key: 'name', label: 'Transformed feature' }, { key: 'value', label: 'Magnitude' }]} /></Panel>
        <Panel title="Predict with the saved model" subtitle="Uses the same fitted preprocessing. Blank fields are treated as missing values.">
          <form onSubmit={predict}><div className="filter-bar">{evaluation.inputs.map((col) => <label key={col.id}>{col.name}<input aria-label={`Prediction ${col.name}`} type={['number', 'integer'].includes(col.data_type) ? 'number' : 'text'} step="any" maxLength={200} value={values[col.id] ?? ''} onChange={(event) => setValues((current) => ({ ...current, [col.id]: event.target.value }))} /></label>)}</div><button className="button" disabled={busy || !selected.model_available}>Predict</button></form>
          {predictions.length > 0 && <><p role="status">Latest prediction: <strong>{String(predictions[0].prediction)}</strong></p><p className="muted">{predictions[0].note}</p>{predictions[0].probabilities && <p>{Object.entries(predictions[0].probabilities).map(([key, value]) => `${key}: ${(100 * value).toFixed(1)}%`).join(' · ')}</p>}<DataTable caption="Saved prediction history" rows={predictions.map((item) => ({ time: new Date(item.created_at).toLocaleString(), prediction: String(item.prediction) }))} columns={[{ key: 'time', label: 'Time' }, { key: 'prediction', label: 'Model prediction' }]} /></>}
          <p className="muted">Prediction outputs are saved for your account; raw input values are not retained.</p>
        </Panel>
      </>}
    </>}
  </>
}
