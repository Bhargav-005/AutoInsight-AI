export class ApiError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
    public details?: Record<string, unknown>,
  ) {
    super(message)
  }
}

export interface DatasetSummary {
  id: string
  display_name: string
  original_filename: string
  source_format: 'csv' | 'xlsx'
  file_size_bytes: number
  created_at: string
  status: 'queued' | 'processing' | 'ready' | 'failed'
  selected_sheet: string | null
  row_count: number | null
  column_count: number | null
  processing_error?: string | null
}
export interface ProfileColumn {
  id: string
  name: string
  data_type: string
  missing_count: number
  missing_percent: number
  distinct_count: number
  distinct_count_is_exact: boolean
  sample_values: (string | number | boolean)[]
  numeric_summary: {
    min: number
    max: number
    mean: number
    median: number
    median_is_approximate: boolean
    non_finite_count: number
  } | null
}
export interface DatasetProfile {
  row_count: number
  column_count: number
  columns: ProfileColumn[]
  duplicate_row_count: number
  quality_summary: {
    missing_cell_count: number
    missing_cell_percent: number
    columns_with_missing_values: number
    duplicate_row_count: number
  }
  methodology: Record<string, string>
  selected_sheet: string | null
}
export type PreviewCell = string | number | boolean | null
export interface DatasetPreview {
  columns: ProfileColumn[]
  rows: Record<string, PreviewCell>[]
  page: number
  page_size: number
  total_rows: number
  total_pages: number
}
export interface DatasetVersion {
  id: string
  version_no: number
  kind: string
  created_at: string
  file_size_bytes: number
  checksum: string
  mime_type: string
}

export interface CleaningOperation {
  op: 'drop_duplicates' | 'drop_missing_rows' | 'fill_missing' | 'trim_whitespace' | 'replace_text' | 'cast_numeric'
  column?: string
  columns?: string[]
  keep?: 'first' | 'last'
  strategy?: 'constant' | 'mode' | 'mean' | 'median'
  value?: string | number
  find?: string
  replace?: string
  invalid?: 'coerce' | 'error'
}
export interface CleaningPlan {
  id: string
  dataset_version_id: string
  state: 'draft' | 'previewed' | 'approved' | 'queued' | 'running' | 'completed' | 'rejected' | 'failed'
  operations: CleaningOperation[]
  preview: {
    source_rows: number
    result_rows: number
    rows_removed: number
    source_missing_cells: number
    result_missing_cells: number
    source_duplicate_rows: number
    result_duplicate_rows: number
    before: Record<string, PreviewCell>[]
    after: Record<string, PreviewCell>[]
    warnings: string[]
  } | null
  job_id: string | null
  attempt_count: number
  result_version_id: string | null
  error_message: string | null
}
export interface CleaningSuggestions {
  dataset_id: string
  dataset_version_id: string
  missing_cells: number
  duplicate_rows: number
  operations: CleaningOperation[]
  notes: string[]
}
export interface AnalyticsColumn {
  id: string
  name: string
  null_count: number
  null_percent: number
  distinct_count: number
  exact: boolean
  numeric: {
    count: number
    mean: number
    median: number
    min: number
    max: number
    stddev: number | null
    histogram: { start: number; end: number; count: number }[]
  } | null
  frequencies: { value: string; count: number }[] | null
  frequency_warning?: string
}
export interface AnalyticsSummary {
  dataset_id: string
  dataset_version_id: string
  operation: string
  selected_columns: string[]
  filters: unknown[]
  grouping: string[]
  rows_analyzed: number
  exact: boolean
  warnings: string[]
  row_count: number
  column_count: number
  duplicate_rows: number
  columns: AnalyticsColumn[]
}
export interface AnalyticsRows {
  dataset_id: string
  dataset_version_id: string
  operation: string
  selected_columns: string[]
  grouping: string[]
  filters: unknown[]
  rows_analyzed: number
  exact: boolean
  warnings: string[]
  rows: Record<string, string | number | null>[]
}
export interface CorrelationResult extends Omit<AnalyticsRows, 'rows'> {
  columns: string[]
  matrix: { column: string; values: (number | null)[] }[]
}

export interface User {
  id: string
  email: string
  display_name: string
  created_at: string
}
export interface Overview {
  datasets: number
  research_runs: number
  ml_experiments: number
  reports: number
}

export interface ResearchStep {
  id: string
  step_index: number
  agent_role: 'understand' | 'clean' | 'analysis' | 'ml' | 'research' | 'knowledge' | 'report'
  tool_name: string | null
  status: 'queued' | 'running' | 'completed' | 'failed' | 'cancelled'
  input_summary: Record<string, unknown>
  output_summary: Record<string, unknown>
  started_at: string
  ended_at: string | null
}
export interface ResearchEvidence {
  id: string
  step_id: string | null
  evidence_type: string
  payload: Record<string, unknown>
}
export interface ReferenceDocument {
  id: string
  title: string
  source_filename: string
  file_type: string
  status: 'queued' | 'processing' | 'indexed' | 'failed' | 'removed'
  page_count: number | null
  chunk_count: number
  processing_error: string | null
  embedding_model: string | null
  embedding_dimensions: number | null
  created_at: string
  size_bytes: number
}
export interface ReportRecord {
  id: string
  research_run_id: string
  status: 'queued' | 'running' | 'completed' | 'failed' | 'cancelled'
  error_message: string | null
  created_at: string
  question: string
  dataset_name: string
}
export interface ResearchRun {
  id: string
  dataset_id: string
  dataset_version_id: string
  question: string
  status: 'draft' | 'awaiting_approval' | 'queued' | 'running' | 'completed' | 'failed' | 'cancelled' | 'rejected'
  plan: {
    rationale?: string
    limitations?: string[]
    steps?: { agent_role: ResearchStep['agent_role']; objective: string; tool_name: string; arguments: Record<string, unknown>; expected_evidence: string }[]
  }
  approval: { status: 'pending' | 'approved' | 'rejected'; approved_at?: string }
  revision_count: number
  steps: ResearchStep[]
  evidence: ResearchEvidence[]
  created_at: string
  failure: string | null
  cancellation_requested: boolean
}

export async function api<T>(
  path: string,
  options: {
    method?: 'GET' | 'POST'
    body?: unknown
    signal?: AbortSignal
    timeoutMs?: number
  } = {},
): Promise<T> {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), options.timeoutMs ?? 8000)
  const abort = () => controller.abort()
  options.signal?.addEventListener('abort', abort, { once: true })
  if (options.signal?.aborted) controller.abort()
  try {
    const headers: Record<string, string> = { Accept: 'application/json' }
    if (options.method === 'POST') {
      const csrf = await api<{ csrf_token: string }>('/auth/csrf', {
        signal: controller.signal,
      })
      headers['X-CSRF-Token'] = csrf.csrf_token
      headers['Content-Type'] = 'application/json'
    }
    const response = await fetch(`/api/v1${path}`, {
      method: options.method ?? 'GET',
      credentials: 'same-origin',
      cache: 'no-store',
      headers,
      signal: controller.signal,
      body:
        options.method === 'POST'
          ? JSON.stringify(options.body ?? {})
          : undefined,
    })
    const body = await response.json().catch(() => null)
    if (!response.ok) {
      if (
        response.status === 401 &&
        !['/auth/login', '/auth/register', '/auth/me'].includes(path)
      )
        window.dispatchEvent(new Event('autoinsight:session-expired'))
      throw new ApiError(
        response.status,
        body?.error?.code ?? 'API_UNAVAILABLE',
        body?.error?.message ?? 'The API is unavailable. Please try again.',
        body?.error?.details,
      )
    }
    if (
      body?.meta?.version !== 'v1' ||
      body.error !== null ||
      body.data == null
    )
      throw new ApiError(
        503,
        'INVALID_RESPONSE',
        'The API returned an unexpected response.',
      )
    return body.data as T
  } catch (error) {
    if (error instanceof ApiError) throw error
    throw new ApiError(
      0,
      'NETWORK_ERROR',
      controller.signal.aborted
        ? 'The request timed out. Please try again.'
        : 'Cannot reach the API. Check that the local backend is running.',
    )
  } finally {
    clearTimeout(timeout)
    options.signal?.removeEventListener('abort', abort)
  }
}

export async function uploadDataset(
  file: File,
  sheetName: string | undefined,
  onProgress: (progress: number | null) => void,
): Promise<DatasetSummary> {
  const csrf = await api<{ csrf_token: string }>('/auth/csrf')
  const form = new FormData()
  form.append('file', file)
  if (sheetName) form.append('sheet_name', sheetName)
  return new Promise((resolve, reject) => {
    const request = new XMLHttpRequest()
    request.timeout = 180_000
    let body: {
      data?: unknown
      meta?: { version?: string }
      error?: { code?: string; message?: string; details?: Record<string, unknown> } | null
    }
    request.open('POST', '/api/v1/datasets')
    request.withCredentials = true
    request.setRequestHeader('Accept', 'application/json')
    request.setRequestHeader('X-CSRF-Token', csrf.csrf_token)
    request.upload.onprogress = (event) => {
      onProgress(event.lengthComputable ? Math.round((event.loaded / event.total) * 100) : null)
    }
    request.onerror = () => reject(new ApiError(0, 'NETWORK_ERROR', 'Cannot reach the API. Check that the local backend is running.'))
    request.onabort = () => reject(new ApiError(0, 'NETWORK_ERROR', 'The upload was interrupted.'))
    request.ontimeout = () => reject(new ApiError(0, 'UPLOAD_TIMEOUT', 'The upload took too long. Please try again.'))
    request.onload = () => {
      try {
        body = JSON.parse(request.responseText) as typeof body
      } catch {
        reject(new ApiError(503, 'INVALID_RESPONSE', 'The API returned an unexpected response.'))
        return
      }
      if (request.status < 200 || request.status >= 300) {
        if (request.status === 401)
          window.dispatchEvent(new Event('autoinsight:session-expired'))
        reject(new ApiError(
          request.status,
          body?.error?.code ?? 'API_UNAVAILABLE',
          body?.error?.message ?? 'The upload could not be completed.',
          body?.error?.details,
        ))
        return
      }
      if (body?.meta?.version !== 'v1' || body.error !== null || body.data == null) {
        reject(new ApiError(503, 'INVALID_RESPONSE', 'The API returned an unexpected response.'))
        return
      }
      resolve(body.data as DatasetSummary)
    }
    request.send(form)
  })
}

export async function uploadReferenceDocument(file: File): Promise<ReferenceDocument> {
  const csrf = await api<{ csrf_token: string }>('/auth/csrf')
  const form = new FormData()
  form.append('file', file)
  const response = await fetch('/api/v1/documents', {
    method: 'POST',
    credentials: 'same-origin',
    cache: 'no-store',
    headers: { Accept: 'application/json', 'X-CSRF-Token': csrf.csrf_token },
    body: form,
  })
  const body = await response.json().catch(() => null)
  if (!response.ok || body?.data == null || body?.meta?.version !== 'v1') {
    throw new ApiError(
      response.status,
      body?.error?.code ?? 'DOCUMENT_UPLOAD_FAILED',
      body?.error?.message ?? 'The document could not be uploaded.',
      body?.error?.details,
    )
  }
  return body.data as ReferenceDocument
}

export async function downloadResearchReport(reportId: string): Promise<void> {
  const response = await fetch(`/api/v1/reports/${reportId}/download`, {
    credentials: 'same-origin',
    cache: 'no-store',
    headers: { Accept: 'application/pdf' },
  })
  if (!response.ok) {
    const body = await response.json().catch(() => null)
    throw new ApiError(
      response.status,
      body?.error?.code ?? 'REPORT_DOWNLOAD_FAILED',
      body?.error?.message ?? 'The report could not be downloaded.',
    )
  }
  const objectUrl = URL.createObjectURL(await response.blob())
  const link = document.createElement('a')
  link.href = objectUrl
  link.download = `autoinsight-report-${reportId.slice(0, 8)}.pdf`
  link.click()
  URL.revokeObjectURL(objectUrl)
}
