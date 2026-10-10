export interface DependencyCheck {
  status: 'not_configured' | 'healthy' | 'unhealthy'
  message: string
}

export interface Readiness {
  status: 'not_ready' | 'ready'
  checks: Record<string, DependencyCheck>
}

export async function fetchReadiness(signal: AbortSignal): Promise<Readiness> {
  const base = (import.meta.env.VITE_API_BASE_URL || 'http://127.0.0.1:8000/api/v1').replace(/\/$/, '')
  const response = await fetch(`${base}/health/ready`, { signal, cache: 'no-store' })
  const body = await response.json()
  // A proxy error page or unrelated 503 must never be shown as a connected API.
  const ready = response.status === 200 && body?.data?.status === 'ready' && body?.error === null
  const unavailable = response.status === 503 && body?.data?.status === 'not_ready'
    && body?.error?.code === 'DEPENDENCIES_UNAVAILABLE'
  if ((!ready && !unavailable) || body?.data?.service !== 'AutoInsight AI' || body?.meta?.version !== 'v1') {
    throw new Error('Unexpected API health response')
  }
  const checks: unknown = body.data.checks
  if (!checks || typeof checks !== 'object' || Array.isArray(checks)
    || Object.keys(checks).sort().join(',') !== 'postgres,redis,worker'
    || !Object.values(checks).every((check: unknown) =>
      typeof check === 'object' && check !== null && 'status' in check
      && ['not_configured', 'healthy', 'unhealthy'].includes(String(check.status))
      && 'message' in check && typeof check.message === 'string')) {
    throw new Error('Invalid API dependency checks')
  }
  const validated = checks as Record<string, DependencyCheck>
  if (ready !== Object.values(validated).every((check) => check.status === 'healthy')) {
    throw new Error('Inconsistent API readiness response')
  }
  return { status: ready ? 'ready' : 'not_ready', checks: validated }
}
