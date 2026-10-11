import { useEffect, useRef, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router'
import { ArrowLeft, ArrowRight, FileSpreadsheet, RefreshCw, UploadCloud } from 'lucide-react'
import { api, ApiError, uploadDataset, type DatasetPreview, type DatasetProfile, type DatasetSummary, type DatasetVersion, type PreviewCell } from '../api/client'
import { Badge, DataTable, Empty, Notice, PageHeader, Panel, ResourceFeedback, TabPanel, Tabs } from '../components/ui'
import type { DataRow } from '../types/domain'
import { isDatasetId } from '../app/datasetId'

interface DatasetDetail extends DatasetSummary {
  checksum: string | null
  version: { id: string; number: number; kind: string } | null
  profile: DatasetProfile | null
}

function message(error: unknown) {
  return error instanceof Error ? error.message : 'The request could not be completed.'
}

function statusTone(status: DatasetSummary['status']) {
  return status === 'ready' ? 'teal' : status === 'failed' ? 'error' : 'copper'
}

function displaySize(bytes: number) {
  return bytes < 1_000_000 ? `${(bytes / 1000).toFixed(1)} KB` : `${(bytes / 1_000_000).toFixed(2)} MB`
}

function displayValue(value: PreviewCell): string | number | null {
  return typeof value === 'boolean' ? String(value) : value
}

export default function Datasets() {
  const { id } = useParams()
  const validDatasetId = isDatasetId(id)
  const navigate = useNavigate()
  const input = useRef<HTMLInputElement>(null)
  const [items, setItems] = useState<DatasetSummary[]>([])
  const [listPage, setListPage] = useState(1)
  const [listTotal, setListTotal] = useState(0)
  const [detail, setDetail] = useState<DatasetDetail | null>(null)
  const [profile, setProfile] = useState<DatasetProfile | null>(null)
  const [preview, setPreview] = useState<DatasetPreview | null>(null)
  const [versions, setVersions] = useState<DatasetVersion[]>([])
  const [page, setPage] = useState(1)
  const [tab, setTab] = useState<'preview' | 'profile' | 'versions'>('preview')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [file, setFile] = useState<File | null>(null)
  const [dragging, setDragging] = useState(false)
  const [progress, setProgress] = useState<number | null>(null)
  const [uploading, setUploading] = useState(false)
  const [uploadError, setUploadError] = useState('')
  const [sheets, setSheets] = useState<string[]>([])
  const [sheetName, setSheetName] = useState('')
  const [reload, setReload] = useState(0)

  useEffect(() => {
    const controller = new AbortController()
    setLoading(true)
    setError('')
    if (!id) {
      api<{ items: DatasetSummary[]; page: number; page_size: number; total: number }>(
        `/datasets?page=${listPage}&page_size=20`,
        { signal: controller.signal },
      ).then((result) => {
        setItems(result.items)
        setListTotal(result.total)
      }).catch((reason: unknown) => {
        if (!controller.signal.aborted) setError(message(reason))
      }).finally(() => {
        if (!controller.signal.aborted) setLoading(false)
      })
      return () => controller.abort()
    }
    if (!validDatasetId) {
      setError('This dataset address is invalid. Choose a dataset from your library.')
      setLoading(false)
      return
    }
    let timer: ReturnType<typeof setTimeout> | undefined
    const load = async () => {
      try {
        const current = await api<DatasetDetail>(`/datasets/${id}`, { signal: controller.signal })
        setDetail(current)
        if (current.status === 'ready') {
          const [nextProfile, nextPreview, nextVersions] = await Promise.all([
            api<DatasetProfile>(`/datasets/${id}/profile`, { signal: controller.signal }),
            api<DatasetPreview>(`/datasets/${id}/preview?page=${page}&page_size=50`, { signal: controller.signal }),
            api<DatasetVersion[]>(`/datasets/${id}/versions`, { signal: controller.signal }),
          ])
          setProfile(nextProfile)
          setPreview(nextPreview)
          setVersions(nextVersions)
          setLoading(false)
          return
        }
        setProfile(null)
        setPreview(null)
        setVersions([])
        setLoading(false)
        if (current.status === 'queued' || current.status === 'processing') {
          timer = setTimeout(() => void load(), 2000)
        }
      } catch (reason) {
        if (!controller.signal.aborted) {
          setError(message(reason))
          setLoading(false)
        }
      }
    }
    void load()
    return () => {
      controller.abort()
      if (timer) clearTimeout(timer)
    }
  }, [id, validDatasetId, page, listPage, reload])

  function chooseFile(next?: File) {
    setUploadError('')
    setSheets([])
    setSheetName('')
    if (!next) return
    if (!/\.(csv|xlsx)$/i.test(next.name)) {
      setFile(null)
      setUploadError('Choose a CSV or XLSX file.')
    } else if (next.size === 0) {
      setFile(null)
      setUploadError('The selected file is empty.')
    } else if (next.size > 25_000_000) {
      setFile(null)
      setUploadError('This file exceeds the 25 MB limit.')
    } else {
      setFile(next)
    }
  }

  async function submitUpload() {
    if (!file || uploading) return
    setUploading(true)
    setProgress(0)
    setUploadError('')
    try {
      const created = await uploadDataset(file, sheetName || undefined, setProgress)
      setFile(null)
      navigate(`/datasets/${created.id}`)
    } catch (reason) {
      if (reason instanceof ApiError && reason.code === 'SHEET_SELECTION_REQUIRED') {
        const candidates = reason.details?.sheets
        if (Array.isArray(candidates) && candidates.every((candidate) => typeof candidate === 'string')) {
          setSheets(candidates)
          setSheetName(candidates[0])
        }
        setUploadError(reason.message)
      } else {
        setUploadError(message(reason))
      }
    } finally {
      setUploading(false)
    }
  }

  async function retryProfile() {
    if (!validDatasetId) return
    setError('')
    try {
      await api(`/datasets/${id}/retry`, { method: 'POST' })
      setReload((value) => value + 1)
    } catch (reason) {
      setError(message(reason))
    }
  }

  const uploadZone = (
    <>
      <div
        className={`upload-zone ${dragging ? 'dragging' : ''}`}
        onDragOver={(event) => { event.preventDefault(); setDragging(true) }}
        onDragLeave={() => setDragging(false)}
        onDrop={(event) => { event.preventDefault(); setDragging(false); chooseFile(event.dataTransfer.files[0]) }}
      >
        <div className="upload-icon"><UploadCloud size={29} /></div>
        <div>
          <h2>Every insight begins with your data.</h2>
          <p>Drop a CSV or XLSX file here, or browse from your device.</p>
          <small>Maximum 25 MB · Original files are stored unchanged</small>
        </div>
        <button className="button secondary" onClick={() => input.current?.click()} disabled={uploading}>
          Choose a file
        </button>
        <input
          ref={input}
          type="file"
          accept=".csv,.xlsx"
          className="sr-only"
          tabIndex={-1}
          aria-label="Choose dataset file"
          onChange={(event) => { chooseFile(event.target.files?.[0]); event.target.value = '' }}
        />
      </div>
      {file && (
        <Panel title="Ready to upload" subtitle={`${file.name} · ${displaySize(file.size)}`}>
          {sheets.length > 0 && (
            <label className="dataset-sheet-select">
              Worksheet
              <select value={sheetName} onChange={(event) => setSheetName(event.target.value)}>
                {sheets.map((sheet) => <option key={sheet} value={sheet}>{sheet}</option>)}
              </select>
            </label>
          )}
          {uploading && <progress className="upload-progress" max={100} value={progress ?? undefined} aria-label="Upload progress" />}
          {uploading && <p role="status">{progress === null ? 'Uploading…' : `Uploading ${progress}%`}</p>}
          {uploadError && <p className="form-error" role="alert">{uploadError}</p>}
          <div className="header-actions">
            <button className="button" onClick={() => void submitUpload()} disabled={uploading}>
              {uploading ? 'Uploading…' : sheets.length ? 'Upload selected worksheet' : 'Upload dataset'}
            </button>
            <button className="button secondary" onClick={() => { setFile(null); setSheets([]); setUploadError('') }} disabled={uploading}>Cancel</button>
          </div>
        </Panel>
      )}
      {uploadError && !file && <p className="form-error" role="alert">{uploadError}</p>}
    </>
  )

  if (!id) {
    return (
      <>
        <PageHeader eyebrow="DATA FOUNDATION" title="Your datasets" description="Upload a source and inspect its profile, preview and version metadata." />
        {uploadZone}
        <Panel title="Dataset library" subtitle={`${listTotal.toLocaleString()} datasets owned by your account`} action={<Badge>{items.length} shown</Badge>}>
          {loading ? <ResourceFeedback state={{ kind: 'loading' }} /> : error ? <ResourceFeedback state={{ kind: 'failed', message: error }} /> : items.length === 0 ? (
            <Empty title="Your workspace is ready for its first dataset.">Upload a CSV or XLSX file above. Files are private to your account and stored locally.</Empty>
          ) : (
            <div className="dataset-list">
              {items.map((item) => (
                <div className="dataset-list-card" key={item.id}>
                  <FileSpreadsheet size={28} aria-hidden="true" />
                  <div>
                    <Link className="dataset-list-title" to={`/datasets/${item.id}`}><h3>{item.display_name}</h3></Link>
                    <p>{item.original_filename} · {item.row_count ?? '—'} rows · {item.column_count ?? '—'} columns · {displaySize(item.file_size_bytes)}</p>
                  </div>
                  <Badge tone={statusTone(item.status)}>{item.status}</Badge>
                  <div className="dataset-list-actions">
                    {item.status === 'ready' && <><Link className="button secondary" to={`/datasets/${item.id}/clean`}>Open Cleaning Studio</Link><Link className="button secondary" to={`/models/${item.id}`}>Open ML Studio</Link></>}
                    <Link className="dataset-open-link" to={`/datasets/${item.id}`} aria-label={`Open ${item.display_name} details`}><ArrowRight size={18} aria-hidden="true" /> Details</Link>
                  </div>
                </div>
              ))}
            </div>
          )}
          {!loading && !error && listTotal > 20 && (
            <div className="dataset-pagination" aria-label="Dataset list pagination">
              <button className="button secondary" disabled={listPage <= 1} onClick={() => setListPage((value) => Math.max(1, value - 1))}>Previous</button>
              <span>Page {listPage} of {Math.ceil(listTotal / 20)}</span>
              <button className="button secondary" disabled={listPage * 20 >= listTotal} onClick={() => setListPage((value) => value + 1)}>Next</button>
            </div>
          )}
        </Panel>
      </>
    )
  }

  const previewRows: DataRow[] = (preview?.rows ?? []).map((row) => Object.fromEntries(
    Object.entries(row).map(([key, value]) => [key, displayValue(value)]),
  ))
  const profileRows: DataRow[] = (profile?.columns ?? []).map((column) => ({
    id: column.id,
    column: column.name,
    type: column.data_type,
    missing: `${column.missing_count} (${column.missing_percent}%)`,
    distinct: `${column.distinct_count}${column.distinct_count_is_exact ? '' : ' approx.'}`,
    sample: column.sample_values.join(', '),
    minimum: column.numeric_summary?.min ?? '—',
    maximum: column.numeric_summary?.max ?? '—',
    mean: column.numeric_summary?.mean ?? '—',
    median: column.numeric_summary ? `${column.numeric_summary.median}${column.numeric_summary.median_is_approximate ? ' approx.' : ''}` : '—',
  }))

  return (
    <>
      {!validDatasetId ? (
        <>
          <PageHeader eyebrow="DATA FOUNDATION" title="Choose a dataset" description="Select a dataset from your private library." />
          <Empty title="This dataset address is invalid">
            Return to your dataset library and open a dataset you own.
            <Link className="button" to="/datasets">Browse datasets</Link>
          </Empty>
        </>
      ) : <>
      <PageHeader
        eyebrow="DATA FOUNDATION"
        title={detail?.display_name ?? 'Dataset workspace'}
        description={detail?.original_filename ?? 'Loading your dataset metadata.'}
        actions={<div className="header-actions"><Link className="button secondary" to="/datasets"><ArrowLeft size={16} /> All datasets</Link>{detail?.status === 'ready' && <><Link className="button" to={`/datasets/${detail.id}/clean`}>Open Cleaning Studio</Link><Link className="button secondary" to={`/models/${detail.id}`}>Open ML Studio</Link></>}</div>}
      />
      {error && <div role="alert"><Notice>{error}</Notice></div>}
      {loading && !detail && <ResourceFeedback state={{ kind: 'loading' }} />}
      {detail && (
        <>
          <Panel title="Source file" subtitle="Uploaded source is immutable; profiles and previews are read-only." action={<Badge tone={statusTone(detail.status)}>{detail.status}</Badge>}>
            <div className="dataset-details">
              <span><strong>Format</strong>{detail.source_format.toUpperCase()}</span>
              <span><strong>File size</strong>{displaySize(detail.file_size_bytes)}</span>
              <span><strong>Uploaded</strong>{new Date(detail.created_at).toLocaleString()}</span>
              <span><strong>Version</strong>{detail.version ? `Raw v${detail.version.number}` : 'Raw v1'}</span>
              <span><strong>Worksheet</strong>{detail.selected_sheet ?? 'CSV source'}</span>
              <span><strong>Dimensions</strong>{detail.row_count ?? '—'} rows × {detail.column_count ?? '—'} columns</span>
            </div>
            {detail.checksum && <p className="dataset-checksum"><strong>SHA-256</strong> <code>{detail.checksum}</code></p>}
            {detail.status === 'failed' && (
              <div role="alert" className="dataset-failure">
                <Notice>{detail.processing_error || 'Profiling failed. Check the file and retry.'}</Notice>
                <button className="button secondary" onClick={() => void retryProfile()}><RefreshCw size={15} /> Retry profiling</button>
              </div>
            )}
            {(detail.status === 'queued' || detail.status === 'processing') && <p role="status">Profiling is running. This page updates automatically.</p>}
          </Panel>
          {detail.status === 'ready' && profile && (
            <>
              <section className="dataset-quality" aria-label="Dataset quality summary">
                <div><strong>{profile.row_count.toLocaleString()}</strong><span>Rows</span></div>
                <div><strong>{profile.column_count}</strong><span>Columns</span></div>
                <div><strong>{profile.quality_summary.missing_cell_count.toLocaleString()}</strong><span>Missing cells · {profile.quality_summary.missing_cell_percent}%</span></div>
                <div><strong>{profile.duplicate_row_count.toLocaleString()}</strong><span>Duplicate rows</span></div>
              </section>
              <Tabs
                value={tab}
                onChange={(value) => setTab(value as typeof tab)}
                items={[
                  { id: 'preview', label: 'Data preview' },
                  { id: 'profile', label: 'Column profile' },
                  { id: 'versions', label: 'Versions & source' },
                ]}
              />
              <TabPanel id={tab}>
              {tab === 'preview' && (
                <Panel title="Actual source records" subtitle={`Page ${preview?.page ?? page} of ${preview?.total_pages ?? 1} · ${preview?.total_rows.toLocaleString() ?? 0} total rows`}>
                  {preview?.rows.length ? <DataTable rows={previewRows} columns={preview.columns.map((column) => ({ key: column.id, label: `${column.name} · ${column.data_type}` }))} caption="Uploaded dataset preview" pageSize={10} /> : <Empty title="No records in this dataset.">The file has headers but contains no data rows.</Empty>}
                  <div className="dataset-pagination">
                    <button className="button secondary" disabled={page <= 1} onClick={() => setPage((value) => Math.max(1, value - 1))}>Previous</button>
                    <span>Page {page} / {preview?.total_pages ?? 1}</span>
                    <button className="button secondary" disabled={page >= (preview?.total_pages ?? 1)} onClick={() => setPage((value) => value + 1)}>Next</button>
                  </div>
                </Panel>
              )}
              {tab === 'profile' && (
                <Panel title="Column profile" subtitle={`${profile.quality_summary.columns_with_missing_values} columns contain missing values`}>
                  <DataTable rows={profileRows} columns={[
                    { key: 'column', label: 'Column' }, { key: 'type', label: 'Detected type' },
                    { key: 'missing', label: 'Missing' }, { key: 'distinct', label: 'Distinct values' },
                    { key: 'minimum', label: 'Minimum' }, { key: 'maximum', label: 'Maximum' },
                    { key: 'mean', label: 'Mean' }, { key: 'median', label: 'Median' },
                    { key: 'sample', label: 'Sample values' },
                  ]} caption="Read-only column profile" pageSize={20} />
                  <p className="dataset-methodology">{profile.methodology.distinct_counts} {profile.methodology.median}</p>
                </Panel>
              )}
              {tab === 'versions' && (
                <Panel title="Version history" subtitle="Raw uploads are immutable; later phases may add derived versions.">
                  {versions.map((version) => (
                    <div className="version-entry" key={version.id}>
                      <span className="timeline-dot" />
                      <div>
                        <h3>Version {version.version_no} <Badge tone="teal">{version.kind}</Badge></h3>
                        <p>{new Date(version.created_at).toLocaleString()} · {displaySize(version.file_size_bytes)} · {version.mime_type}</p>
                        <small>SHA-256: <code>{version.checksum}</code></small>
                      </div>
                    </div>
                  ))}
                </Panel>
              )}
              </TabPanel>
            </>
          )}
          {detail.status === 'ready' && !profile && <ResourceFeedback state={{ kind: 'failed', message: 'The profile is not available.' }} />}
        </>
      )}
      </>}
    </>
  )
}
