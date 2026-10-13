import { useCallback, useEffect, useState } from 'react'
import { Download, FileText, RefreshCw } from 'lucide-react'
import { api, downloadResearchReport, type ReportRecord } from '../api/client'
import { Badge, Empty, PageHeader, Panel, ResourceFeedback } from '../components/ui'

type Feedback = { kind: 'failed'; message: string }

export default function History() {
  const [reports, setReports] = useState<ReportRecord[]>([])
  const [feedback, setFeedback] = useState<Feedback | null>(null)
  const [busyId, setBusyId] = useState<string | null>(null)

  const refresh = useCallback(async (signal?: AbortSignal) => {
    setReports(await api<ReportRecord[]>('/reports', { signal }))
  }, [])

  useEffect(() => {
    const controller = new AbortController()
    void refresh(controller.signal).catch((error) => {
      if (!controller.signal.aborted) setFeedback({ kind: 'failed', message: (error as Error).message })
    })
    return () => controller.abort()
  }, [refresh])

  const pending = reports.some((item) => item.status === 'queued' || item.status === 'running')
  useEffect(() => {
    if (!pending) return
    const timer = window.setInterval(() => {
      void refresh().catch((error) => setFeedback({ kind: 'failed', message: (error as Error).message }))
    }, 1800)
    return () => window.clearInterval(timer)
  }, [pending, refresh])

  async function download(report: ReportRecord) {
    setBusyId(report.id)
    setFeedback(null)
    try {
      await downloadResearchReport(report.id)
    } catch (error) {
      setFeedback({ kind: 'failed', message: (error as Error).message })
    } finally {
      setBusyId(null)
    }
  }

  return <>
    <PageHeader eyebrow="A RECORD OF YOUR REASONING" title="Reports & history" description="Return to completed investigations and download their source-linked PDF reports." actions={<button className="button secondary" onClick={() => void refresh()}><RefreshCw size={16} />Refresh</button>} />
    <div className="history-intro"><FileText size={29} /><div><h2>Insights deserve a paper trail.</h2><p>Each generated report is tied to a completed investigation and its verified evidence.</p></div><Badge>Reporting · Phase 8</Badge></div>
    {feedback && <ResourceFeedback state={feedback} />}
    <Panel title="Generated reports" subtitle={`${reports.length} saved report${reports.length === 1 ? '' : 's'}`}>
      {reports.length === 0 ? <Empty title="No reports generated yet.">Complete an investigation, then choose Generate PDF report to create a downloadable report.</Empty> : <div className="history-list">{reports.map((report) => <article key={report.id}>
        <span className="history-icon"><FileText size={21} /></span>
        <div><strong>{report.question}</strong><p>{report.dataset_name} · <time dateTime={report.created_at}>{new Date(report.created_at).toLocaleString()}</time> · {report.id.slice(0, 8)}</p>{report.error_message && <p className="warning-note">{report.error_message}</p>}</div>
        <Badge tone={report.status === 'completed' ? 'teal' : report.status === 'failed' ? 'error' : 'neutral'}>{report.status}</Badge>
        <button className="icon-button" aria-label={`Download report for ${report.question}`} disabled={report.status !== 'completed' || busyId === report.id} onClick={() => void download(report)}><Download size={18} /></button>
      </article>)}</div>}
    </Panel>
  </>
}
