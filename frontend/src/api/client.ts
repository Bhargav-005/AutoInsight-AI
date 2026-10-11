export class ApiError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
  ) {
    super(message)
  }
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

export async function api<T>(
  path: string,
  options: {
    method?: 'GET' | 'POST'
    body?: unknown
    signal?: AbortSignal
  } = {},
): Promise<T> {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), 8000)
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
