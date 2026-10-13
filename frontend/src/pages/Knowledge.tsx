import { useCallback, useEffect, useState } from 'react'
import { BookOpen, FileText, RefreshCw, Trash2, Upload } from 'lucide-react'
import { api, uploadReferenceDocument, type ReferenceDocument } from '../api/client'
import { Badge, Empty, PageHeader, Panel, ResourceFeedback } from '../components/ui'

type Feedback = { kind: 'failed'; message: string }

export default function Knowledge() {
  const [documents, setDocuments] = useState<ReferenceDocument[]>([])
  const [busy, setBusy] = useState(false)
  const [feedback, setFeedback] = useState<Feedback | null>(null)

  const refresh = useCallback(async (signal?: AbortSignal) => {
    const items = await api<ReferenceDocument[]>('/documents', { signal })
    setDocuments(items)
  }, [])

  useEffect(() => {
    const controller = new AbortController()
    void refresh(controller.signal).catch((error) => {
      if (!controller.signal.aborted) setFeedback({ kind: 'failed', message: (error as Error).message })
    })
    return () => controller.abort()
  }, [refresh])

  const processing = documents.some((item) => item.status === 'queued' || item.status === 'processing')
  useEffect(() => {
    if (!processing) return
    const timer = window.setInterval(() => {
      void refresh().catch((error) => setFeedback({ kind: 'failed', message: (error as Error).message }))
    }, 1800)
    return () => window.clearInterval(timer)
  }, [processing, refresh])

  async function upload(file?: File) {
    if (!file) return
    setBusy(true)
    setFeedback(null)
    try {
      const item = await uploadReferenceDocument(file)
      setDocuments((current) => [item, ...current.filter((value) => value.id !== item.id)])
    } catch (error) {
      setFeedback({ kind: 'failed', message: (error as Error).message })
    } finally {
      setBusy(false)
    }
  }

  async function documentAction(item: ReferenceDocument, action: 'reindex' | 'remove') {
    setBusy(true)
    setFeedback(null)
    try {
      const updated = await api<ReferenceDocument>(`/documents/${item.id}/${action}`, { method: 'POST' })
      setDocuments((current) => current.map((value) => value.id === item.id ? updated : value))
    } catch (error) {
      setFeedback({ kind: 'failed', message: (error as Error).message })
    } finally {
      setBusy(false)
    }
  }

  return <>
    <PageHeader eyebrow="PRIVATE LOCAL SOURCES" title="Knowledge Base" description="Index reference PDFs, Word documents and text files for cited research. Sources stay private to your workspace." />
    {feedback && <ResourceFeedback state={feedback} />}
    <Panel title="Add a reference document" subtitle="PDF, DOCX or TXT · up to 25 MB · local embeddings">
      <label className="button secondary">
        <Upload size={17} /> {busy ? 'Working…' : 'Choose a document'}
        <input aria-label="Choose a reference document" type="file" accept=".pdf,.docx,.txt,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document,text/plain" disabled={busy} hidden onChange={(event) => { void upload(event.target.files?.[0]); event.currentTarget.value = '' }} />
      </label>
      <p className="muted">Text is extracted locally. Scanned PDFs without an OCR text layer are reported as unsupported.</p>
    </Panel>
    <Panel title="Your indexed sources" subtitle={`${documents.length} saved reference${documents.length === 1 ? '' : 's'}`}>
      {documents.length === 0 ? <Empty title="No reference documents yet.">Add a PDF, DOCX or TXT file to make it available for approved research plans.</Empty> : <div className="history-list">{documents.map((item) => <article key={item.id}>
        <span className="history-icon"><FileText size={20} /></span>
        <div><strong>{item.source_filename}</strong><p>{item.file_type} · {(item.size_bytes / 1024).toFixed(0)} KB{item.page_count ? ` · ${item.page_count} pages` : ''} · {item.chunk_count} passages</p>{item.processing_error && <p className="warning-note">{item.processing_error}</p>}</div>
        <Badge tone={item.status === 'indexed' ? 'teal' : item.status === 'failed' ? 'error' : 'neutral'}>{item.status}</Badge>
        {item.status === 'failed' || item.status === 'removed' ? <button className="icon-button" aria-label={`Retry indexing ${item.source_filename}`} disabled={busy} onClick={() => void documentAction(item, 'reindex')}><RefreshCw size={17} /></button> : item.status === 'indexed' ? <button className="icon-button" aria-label={`Remove ${item.source_filename} from index`} disabled={busy} onClick={() => void documentAction(item, 'remove')}><Trash2 size={17} /></button> : <BookOpen size={18} aria-label="Indexing" />}
      </article>)}</div>}
    </Panel>
  </>
}
