import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router'
import { Activity, BookOpen, CheckCheck, FileText, FlaskConical, Network, Play, RefreshCw, SlidersHorizontal, X } from 'lucide-react'
import { api, type DatasetSummary, type DatasetVersion, type ReferenceDocument, type ResearchRun, type ResearchStep } from '../api/client'
import { isDatasetId } from '../app/datasetId'
import { Badge, Empty, PageHeader, Panel, ResourceFeedback } from '../components/ui'

const roles: { id: ResearchStep['agent_role']; name: string; icon: typeof Activity }[] = [
  { id: 'understand', name: 'Data Understanding', icon: Network },
  { id: 'clean', name: 'Data Cleaning', icon: SlidersHorizontal },
  { id: 'analysis', name: 'Data Analysis', icon: Activity },
  { id: 'ml', name: 'ML Engineer', icon: FlaskConical },
  { id: 'research', name: 'Research & Verification', icon: CheckCheck },
  { id: 'knowledge', name: 'RAG Knowledge', icon: BookOpen },
  { id: 'report', name: 'Report & Insights', icon: FileText },
]

type DatasetCollection = { items: DatasetSummary[] }
type Comparison = {
  claim: string
  dataset_evidence_id: string
  dataset_version_id: string
  target_met: boolean
  citations: { source_filename: string; page_number: number | null; chunk_id: string; excerpt: string; evidence_id: string }[]
}
type Feedback = { kind: 'failed'; message: string }

function statusTone(status: ResearchRun['status']): 'neutral' | 'teal' | 'copper' | 'error' {
  if (status === 'completed') return 'teal'
  if (status === 'failed') return 'error'
  if (status === 'awaiting_approval') return 'copper'
  return 'neutral'
}

function formatRole(role: string) {
  return roles.find((item) => item.id === role)?.name ?? role
}

export default function Research() {
  const { id: routeDatasetId } = useParams()
  const navigate = useNavigate()
  const [datasets, setDatasets] = useState<DatasetSummary[]>([])
  const [datasetId, setDatasetId] = useState(isDatasetId(routeDatasetId) ? routeDatasetId : '')
  const [versions, setVersions] = useState<DatasetVersion[]>([])
  const [versionId, setVersionId] = useState('')
  const [question, setQuestion] = useState('')
  const [revisionFeedback, setRevisionFeedback] = useState('')
  const [history, setHistory] = useState<ResearchRun[]>([])
  const [documents, setDocuments] = useState<ReferenceDocument[]>([])
  const [selectedDocumentIds, setSelectedDocumentIds] = useState<string[]>([])
  const [activeRun, setActiveRun] = useState<ResearchRun | null>(null)
  const [feedback, setFeedback] = useState<Feedback | null>(null)
  const [busy, setBusy] = useState(false)
  const [historyOpen, setHistoryOpen] = useState(false)
  const [reportMessage, setReportMessage] = useState('')

  const readyDatasets = useMemo(() => datasets.filter((item) => item.status === 'ready'), [datasets])
  const selectedDataset = readyDatasets.find((item) => item.id === datasetId)
  const running = activeRun && ['queued', 'running'].includes(activeRun.status)
  const finalEvidence = activeRun?.evidence.find((item) => item.evidence_type === 'synthesize_evidence')
  const finalResult = finalEvidence?.payload.result as { comparisons?: Comparison[]; interpretation?: string; findings?: { claim: string; evidence_id: string; exact: boolean }[]; document_findings?: { claim: string; citations: { source_filename: string; page_number: number | null; chunk_id: string; excerpt: string }[] }[]; limitations?: string[] } | undefined

  const loadHistory = useCallback(async () => {
    const result = await api<ResearchRun[]>('/research')
    setHistory(result)
    if (activeRun) {
      const current = result.find((item) => item.id === activeRun.id)
      if (current) setActiveRun(current)
    }
  }, [activeRun])

  useEffect(() => {
    const controller = new AbortController()
    async function load() {
      try {
        const [collection, runs, references] = await Promise.all([
          api<DatasetCollection>('/datasets?page=1&page_size=100', { signal: controller.signal }),
          api<ResearchRun[]>('/research', { signal: controller.signal }),
          api<ReferenceDocument[]>('/documents', { signal: controller.signal }),
        ])
        setDatasets(collection.items)
        setHistory(runs)
        setDocuments(references)
        setDatasetId((current) => {
          const requested = isDatasetId(routeDatasetId) ? routeDatasetId : current
          return collection.items.some((item) => item.id === requested && item.status === 'ready')
            ? requested
            : collection.items.find((item) => item.status === 'ready')?.id ?? ''
        })
      } catch (error) {
        if (!controller.signal.aborted) setFeedback({ kind: 'failed', message: (error as Error).message })
      }
    }
    void load()
    return () => controller.abort()
  }, [routeDatasetId])

  useEffect(() => {
    if (!datasetId || !isDatasetId(datasetId)) {
      setVersions([])
      setVersionId('')
      return
    }
    const controller = new AbortController()
    setVersions([])
    setVersionId('')
    api<DatasetVersion[]>(`/datasets/${datasetId}/versions`, { signal: controller.signal })
      .then((items) => {
        setVersions(items)
        setVersionId((selected) => items.some((item) => item.id === selected) ? selected : items.at(-1)?.id ?? '')
      })
      .catch((error) => {
        if (!controller.signal.aborted) setFeedback({ kind: 'failed', message: (error as Error).message })
      })
    return () => controller.abort()
  }, [datasetId])

  useEffect(() => {
    if (!running || !activeRun) return
    const timer = window.setTimeout(() => {
      api<ResearchRun>(`/research/${activeRun.id}`)
        .then((run) => setActiveRun(run))
        .catch((error) => setFeedback({ kind: 'failed', message: (error as Error).message }))
    }, 1500)
    return () => window.clearTimeout(timer)
  }, [activeRun, running])

  function selectDataset(value: string) {
    const valid = readyDatasets.some((item) => item.id === value) ? value : ''
    setDatasetId(valid)
    setActiveRun(null)
    setQuestion('')
    if (valid) navigate(`/research/${valid}`)
    else navigate('/research/preview')
  }

  async function createPlan() {
    if (!selectedDataset || !isDatasetId(selectedDataset.id) || !versionId || !question.trim()) return
    setBusy(true)
    setFeedback(null)
    setActiveRun(null)
    try {
      const run = await api<ResearchRun>('/research', {
        method: 'POST',
        body: { dataset_id: selectedDataset.id, dataset_version_id: versionId, question: question.trim(), document_ids: selectedDocumentIds },
        timeoutMs: 180_000,
      })
      setActiveRun(run)
      await loadHistory()
    } catch (error) {
      setFeedback({ kind: 'failed', message: (error as Error).message })
    } finally {
      setBusy(false)
    }
  }

  async function generateReport() {
    if (!activeRun || activeRun.status !== 'completed') return
    setBusy(true)
    setReportMessage('')
    try {
      const report = await api<{ id: string }>('/reports', { method: 'POST', body: { research_run_id: activeRun.id } })
      setReportMessage(`Report queued (${report.id.slice(0, 8)}). Track and download it in Reports & History.`)
    } catch (error) {
      setFeedback({ kind: 'failed', message: (error as Error).message })
    } finally {
      setBusy(false)
    }
  }

  async function runAction(action: 'approve' | 'reject' | 'revise' | 'start' | 'cancel') {
    if (!activeRun) return
    setBusy(true)
    setFeedback(null)
    try {
      const result = await api<ResearchRun>(`/research/${activeRun.id}/${action}`, {
        method: 'POST',
        ...(action === 'approve' || action === 'reject'
          ? { body: { confirm: true } }
          : action === 'revise'
            ? { body: { feedback: revisionFeedback.trim() } }
            : {}),
      })
      setActiveRun(result)
      if (action === 'revise') setRevisionFeedback('')
      await loadHistory()
    } catch (error) {
      setFeedback({ kind: 'failed', message: (error as Error).message })
    } finally {
      setBusy(false)
    }
  }

  async function reopen(run: ResearchRun) {
    setHistoryOpen(false)
    setActiveRun(null)
    setDatasetId(run.dataset_id)
    setVersionId(run.dataset_version_id)
    setQuestion(run.question)
    navigate(`/research/${run.dataset_id}`)
    try {
      setActiveRun(await api<ResearchRun>(`/research/${run.id}`))
    } catch (error) {
      setFeedback({ kind: 'failed', message: (error as Error).message })
    }
  }

  const executedRoles = new Map<string, ResearchStep['status']>()
  for (const step of activeRun?.steps ?? []) executedRoles.set(step.agent_role, step.status)

  return (
    <>
      <PageHeader
        eyebrow="THE INVESTIGATION ROOM"
        title="Follow the reasoning."
        description="Ask a question, review the local model’s plan, then approve deterministic tools and inspect their evidence."
        actions={<button className="button secondary" onClick={() => setHistoryOpen((open) => !open)}><RefreshCw size={16} />Research history</button>}
      />
      {feedback && <ResourceFeedback state={feedback} />}
      {!readyDatasets.length ? (
        <Empty title="A ready dataset is needed for research." action={<Link className="button" to="/datasets">Open Datasets</Link>}>
          Upload a CSV or XLSX dataset and wait for its profile to finish. No request will be sent until a real dataset version is selected.
        </Empty>
      ) : (
        <div className="research-workspace">
          <Panel title="Investigation brief" subtitle="A saved plan must be approved before tools can run." className="research-brief">
            <label className="research-field">Dataset
              <select aria-label="Research dataset" value={datasetId} onChange={(event) => selectDataset(event.target.value)}>
                {readyDatasets.map((item) => <option value={item.id} key={item.id}>{item.display_name}</option>)}
              </select>
            </label>
            <label className="research-field">Immutable version
              <select aria-label="Dataset version" value={versionId} onChange={(event) => { setVersionId(event.target.value); setActiveRun(null) }} disabled={!versions.length}>
                {versions.map((item) => <option key={item.id} value={item.id}>v{item.version_no} · {item.kind} · {item.id.slice(0, 8)}</option>)}
              </select>
            </label>
            <div className="research-dataset-context">
              <span className="eyebrow">SELECTED SOURCE</span>
              <strong>{selectedDataset?.display_name ?? 'Choose a ready dataset'}</strong>
              <small>{versions.find((item) => item.id === versionId)?.kind ?? 'No version selected'} · exact version is included in every evidence record</small>
            </div>
            <label className="research-field">Research question
              <textarea rows={4} maxLength={1000} value={question} onChange={(event) => setQuestion(event.target.value)} placeholder="Which region has the highest average profit? Provide the exact average and evidence." />
            </label>
            <fieldset className="research-field">
              <legend>Reference documents (optional)</legend>
              {documents.filter((item) => item.status === 'indexed').length ? documents.filter((item) => item.status === 'indexed').map((item) => <label className="approval-check" key={item.id}><input type="checkbox" checked={selectedDocumentIds.includes(item.id)} onChange={(event) => setSelectedDocumentIds((current) => event.target.checked ? [...current, item.id] : current.filter((id) => id !== item.id))} />{item.source_filename}</label>) : <small>No indexed documents. <Link to="/knowledge">Open Knowledge Base</Link>.</small>}
              <small>Selected source IDs are bound into the approved plan. Only retrieved passages can support document claims.</small>
            </fieldset>
            <button className="button full-width" onClick={() => void createPlan()} disabled={busy || !selectedDataset || !versionId || question.trim().length < 8}>
              {busy ? 'Planning with local Ollama…' : 'Generate research plan'}
            </button>
            <p className="research-local-note">Local model: {import.meta.env.VITE_OLLAMA_MODEL ?? 'qwen3.5:4b-q4_K_M'} · one shared Ollama instance · no dataset rows are included in planning context.</p>
          </Panel>

          <div className="research-results">
            {activeRun ? (
              <>
                <Panel title="Proposed plan and execution" subtitle={activeRun.plan.rationale ?? 'Persisted research plan'} action={<Badge tone={statusTone(activeRun.status)}>{activeRun.status.replace('_', ' ')}</Badge>}>
                  <p>{activeRun.question}</p>
                  {activeRun.plan.limitations?.map((item, index) => <p className="warning-note" key={`${item}-${index}`}>{item}</p>)}
                  <ol className="research-plan-list">
                    {activeRun.plan.steps?.map((step, index) => <li key={`${step.tool_name}-${index}`}><span className="research-step-index">{String(index + 1).padStart(2, '0')}</span><span><strong>{formatRole(step.agent_role)}</strong><small>{step.objective}</small><code>{step.tool_name} · {JSON.stringify(step.arguments)}</code></span><Badge>{step.expected_evidence}</Badge></li>)}
                  </ol>
                  {activeRun.status === 'awaiting_approval' && activeRun.approval.status === 'pending' && <>
                    {activeRun.revision_count < 1 && <label className="research-field">Request one bounded revision
                      <textarea rows={2} maxLength={500} value={revisionFeedback} onChange={(event) => setRevisionFeedback(event.target.value)} placeholder="Ask for a supported change to the proposed steps." />
                    </label>}
                    <div className="button-row research-actions">
                      <button className="button" disabled={busy} onClick={() => void runAction('approve')}>Approve exact plan</button>
                      <button className="button secondary" disabled={busy} onClick={() => void runAction('reject')}>Reject plan</button>
                      {activeRun.revision_count < 1 && <button className="button secondary" disabled={busy || revisionFeedback.trim().length < 3} onClick={() => void runAction('revise')}>Revise once</button>}
                    </div>
                  </>}
                  {activeRun.status === 'awaiting_approval' && activeRun.approval.status === 'approved' && <button className="button" disabled={busy} onClick={() => void runAction('start')}><Play size={16} />Start investigation</button>}
                  {activeRun.status === 'queued' && <p role="status">Queued for the local worker. Waiting for the first saved agent step…</p>}
                  {activeRun.status === 'running' && <p role="status">Research is running. Progress updates as each step is persisted.</p>}
                  {activeRun.status === 'running' || activeRun.status === 'queued' ? <button className="text-button" disabled={busy} onClick={() => void runAction('cancel')}><X size={15} />Cancel investigation</button> : null}
                  {activeRun.status === 'failed' && <p className="warning-note" role="alert">{activeRun.failure ?? 'Research failed. No findings were marked complete.'}</p>}
                  {activeRun.status === 'cancelled' && <p role="status">Investigation cancelled at a safe boundary.</p>}
                  {activeRun.status === 'rejected' && <p role="status">Plan rejected. No tools were executed.</p>}
                </Panel>

                <Panel title="Agent activity" subtitle="Roles without a persisted step are shown as skipped.">
                  <div className="research-role-map">{roles.map(({ id, name, icon: Icon }) => {
                    const state = executedRoles.get(id)
                    const planned = activeRun.plan.steps?.some((item) => item.agent_role === id)
                    return <div className={`research-role ${state ? `is-${state}` : ''}`} key={id}><Icon size={17} /><strong>{name}</strong><span>{state ?? (planned ? 'planned' : 'skipped')}</span></div>
                  })}</div>
                  <ol className="research-trace">{activeRun.steps.map((step) => <li key={step.id} className={`trace-${step.status}`}><div><strong>{formatRole(step.agent_role)}</strong><Badge>{step.status}</Badge></div><p>{String(step.input_summary.objective ?? '')}</p><code>{step.tool_name ?? 'read-only capability'}</code><small>{step.started_at ? new Date(step.started_at).toLocaleString() : ''}</small></li>)}</ol>
                  {!activeRun.steps.length && <p className="muted">No execution steps have been saved.</p>}
                </Panel>

                <Panel title="Verified findings and evidence" subtitle={`Dataset ${activeRun.dataset_id} · version ${activeRun.dataset_version_id}`}>
                  {activeRun.status === 'completed' && finalResult ? <div className="research-final"><p>{finalResult.interpretation}</p>{finalResult.findings?.length ? <ul>{finalResult.findings.map((finding, index) => <li key={`${finding.evidence_id}-${index}`}>{finding.claim} <Badge tone={finding.exact ? 'teal' : 'copper'}>{finding.exact ? 'exact' : 'estimated'}</Badge></li>)}</ul> : <p>No quantitative finding was supported by verified evidence.</p>}{finalResult.comparisons?.map((comparison) => <article className="research-evidence" key={`${comparison.dataset_evidence_id}-${comparison.claim}`}>
                    <strong>{comparison.claim}</strong>
                    <p><Badge tone={comparison.target_met ? 'teal' : 'copper'}>{comparison.target_met ? 'Target met' : 'Target not met'}</Badge></p>
                    <small>Dataset evidence {comparison.dataset_evidence_id} · version {comparison.dataset_version_id}</small>
                    {comparison.citations.map((citation) => <blockquote key={citation.chunk_id}><p>{citation.excerpt}</p><small>{citation.source_filename}{citation.page_number ? ` · page ${citation.page_number}` : ''} · passage {citation.chunk_id} · document evidence {citation.evidence_id}</small></blockquote>)}
                  </article>)}{finalResult.document_findings?.map((finding, index) => <article className="research-evidence" key={`${finding.claim}-${index}`}><strong>{finding.claim}</strong>{finding.citations.map((citation) => <blockquote key={citation.chunk_id}><p>{citation.excerpt}</p><small>{citation.source_filename}{citation.page_number ? ` · page ${citation.page_number}` : ''} · passage {citation.chunk_id.slice(0, 8)}</small></blockquote>)}</article>)}{finalResult.limitations?.map((item, index) => <p className="warning-note" key={`${item}-${index}`}>{item}</p>)}<button className="button secondary" disabled={busy} onClick={() => void generateReport()}><FileText size={16} />Generate PDF report</button>{reportMessage && <p role="status">{reportMessage} <Link to="/history">Open Reports &amp; History</Link></p>}</div> : activeRun.status !== 'completed' ? <p className="muted">Findings appear after deterministic evidence has passed verification.</p> : null}
                  {activeRun.evidence.map((item) => <details className="research-evidence" key={item.id}><summary>{item.evidence_type} · evidence {item.id.slice(0, 8)}</summary><pre>{JSON.stringify(item.payload, null, 2)}</pre></details>)}
                </Panel>
              </>
            ) : (
              <Panel title="Seven logical roles. One local model." subtitle="LangGraph coordinates only roles selected for the approved question.">
                <div className="research-role-map">{roles.map(({ id, name, icon: Icon }) => <div className="research-role is-skipped" key={id}><Icon size={17} /><strong>{name}</strong><span>available</span></div>)}</div>
                <p className="chart-note">Planning uses schema and aggregate metadata only. Dataset cell text is not copied into prompts. Analytical tools run only after explicit approval.</p>
                <div className="context-block"><span className="eyebrow">LOCAL MODEL STATUS</span><strong>Ollama · {import.meta.env.VITE_OLLAMA_MODEL ?? 'qwen3.5:4b-q4_K_M'}</strong><small>If planning reports Ollama unavailable, check the local Ollama service and configured model.</small></div>
              </Panel>
            )}
          </div>
        </div>
      )}
      {historyOpen && <div className="research-history-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setHistoryOpen(false) }}><section className="research-history" role="dialog" aria-modal="true" aria-labelledby="research-history-title"><div><h2 id="research-history-title">Saved research</h2><button className="icon-button" aria-label="Close research history" onClick={() => setHistoryOpen(false)}><X size={18} /></button></div>{history.length ? history.map((run) => <button className="history-run" key={run.id} onClick={() => void reopen(run)}><strong>{run.question}</strong><span>{new Date(run.created_at).toLocaleString()} · {run.status}</span></button>) : <p>No saved research runs yet.</p>}</section></div>}
    </>
  )
}
