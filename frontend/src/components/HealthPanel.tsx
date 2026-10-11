import { useEffect, useState } from 'react'
import { fetchReadiness, type Readiness } from '../api/health'

type Status =
  | { kind: 'checking' }
  | { kind: 'unavailable' }
  | { kind: 'connected'; data: Readiness }

export default function HealthPanel() {
  const [status, setStatus] = useState<Status>({ kind: 'checking' })
  const [attempt, setAttempt] = useState(0)

  useEffect(() => {
    const controller = new AbortController()
    let active = true
    const timeout = window.setTimeout(() => controller.abort(), 5000)
    setStatus({ kind: 'checking' })
    fetchReadiness(controller.signal)
      .then((data) => {
        if (active) setStatus({ kind: 'connected', data })
      })
      .catch(() => {
        if (active) setStatus({ kind: 'unavailable' })
      })
      .finally(() => window.clearTimeout(timeout))
    return () => {
      active = false
      controller.abort()
      window.clearTimeout(timeout)
    }
  }, [attempt])

  useEffect(() => {
    const timer = window.setInterval(
      () => setAttempt((value) => value + 1),
      30000,
    )
    return () => window.clearInterval(timer)
  }, [])

  const heading =
    status.kind === 'checking'
      ? 'Checking connection…'
      : status.kind === 'connected'
        ? `API connected · Platform ${status.data.status === 'ready' ? 'ready' : 'not ready'}`
        : 'API unavailable'

  return (
    <section className="health-view">
      <header className="brand">
        <span className="brand-mark" aria-hidden="true">
          A
        </span>
        <span>AutoInsight AI</span>
        <span className="local-label">LOCAL DEVELOPMENT</span>
      </header>
      <section className="intro" aria-labelledby="title">
        <p className="eyebrow">EXPLAINABLE DATA ANALYSIS</p>
        <h1 id="title">AutoInsight AI</h1>
        <p className="lead">
          A clear path from your data to evidence-backed insights.
        </p>
      </section>
      <section className="status-card" aria-labelledby="status-title">
        <div className="card-top">
          <h2 id="status-title">Application status</h2>
          <span className="checkpoint">Live diagnostics</span>
        </div>
        <div
          className={`connection ${status.kind} ${status.kind === 'connected' && status.data.status === 'ready' ? 'ready' : ''}`}
          role="status"
          aria-live="polite"
        >
          <span className="status-dot" aria-hidden="true" />
          <strong>{heading}</strong>
        </div>
        <p className="explanation">
          {status.kind === 'connected'
            ? status.data.status === 'ready'
              ? 'The API, database, queue and worker are responding. Your local foundation is ready.'
              : 'The API is responding, but one or more required services are unavailable. Check the service status below.'
            : status.kind === 'checking'
              ? 'Requesting the current status from your local API.'
              : 'Could not verify the API status. Check that the backend is running and its address is configured correctly.'}
        </p>
        {status.kind === 'connected' && (
          <dl className="dependencies">
            {Object.entries(status.data.checks).map(([name, check]) => (
              <div key={name}>
                <dt>
                  {name === 'postgres'
                    ? 'PostgreSQL'
                    : name === 'redis'
                      ? 'Redis'
                      : 'Worker'}
                </dt>
                <dd>
                  <span className={check.status}>
                    {check.status === 'healthy'
                      ? 'Available'
                      : check.status === 'unhealthy'
                        ? 'Unavailable'
                        : 'Not configured'}
                  </span>
                  <small>{check.message}</small>
                </dd>
              </div>
            ))}
          </dl>
        )}
        <button
          type="button"
          onClick={() => setAttempt((value) => value + 1)}
          disabled={status.kind === 'checking'}
        >
          Check again <span aria-hidden="true">↗</span>
        </button>
        <p className="refresh-note">Refreshes every 30 seconds.</p>
      </section>
      <footer>
        Foundation in progress. Dataset analysis and AI workflows arrive in
        later phases.
      </footer>
    </section>
  )
}
