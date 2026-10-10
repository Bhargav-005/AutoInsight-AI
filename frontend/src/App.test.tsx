import { act, fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import App from './App'

const response = () => new Response(JSON.stringify({
  data: { service: 'AutoInsight AI', status: 'not_ready', checks: {
    postgres: { status: 'not_configured', message: 'Database integration is not implemented.' },
    redis: { status: 'not_configured', message: 'Queue connection is not implemented.' },
    worker: { status: 'not_configured', message: 'Worker integration is not implemented.' },
  } }, meta: { version: 'v1' }, error: { code: 'DEPENDENCIES_UNAVAILABLE' },
}), { status: 503 })

describe('application status', () => {
  it('shows ready only when every reported service is healthy', async () => {
    const body = await response().json()
    body.data.status = 'ready'
    body.error = null
    Object.values(body.data.checks).forEach((check) => {
      (check as { status: string }).status = 'healthy'
    })
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify(body), { status: 200 })))
    render(<App />)
    expect(await screen.findByText('API connected · Platform ready')).toBeInTheDocument()
    expect(screen.getAllByText('Available')).toHaveLength(3)
  })

  it('shows loading without claiming a healthy backend', () => {
    vi.stubGlobal('fetch', vi.fn(() => new Promise(() => {})))
    render(<App />)
    expect(screen.getByRole('heading', { name: 'AutoInsight AI' })).toBeInTheDocument()
    expect(screen.getByRole('status')).toHaveTextContent('Checking connection')
    expect(screen.getByRole('button')).toBeDisabled()
  })

  it('shows genuine 503 readiness as connected but not ready', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(response()))
    render(<App />)
    expect(await screen.findByText('API connected · Platform not ready')).toBeInTheDocument()
    expect(screen.getAllByText('Not configured')).toHaveLength(3)
  })

  it('shows disconnection and recovers on retry', async () => {
    const fetch = vi.fn().mockRejectedValueOnce(new TypeError('Network error')).mockResolvedValue(response())
    vi.stubGlobal('fetch', fetch)
    render(<App />)
    expect(await screen.findByText('API unavailable')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: /Check again/ }))
    expect(await screen.findByText('API connected · Platform not ready')).toBeInTheDocument()
  })

  it('does not mistake an unrelated 503 for an API connection', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('Gateway unavailable', { status: 503 })))
    render(<App />)
    expect(await screen.findByText('API unavailable')).toBeInTheDocument()
  })

  it('times out a stalled request', async () => {
    vi.useFakeTimers()
    vi.stubGlobal('fetch', vi.fn((_url, { signal }) => new Promise((_resolve, reject) => {
      signal.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')))
    })))
    render(<App />)
    await act(async () => { await vi.advanceTimersByTimeAsync(5000) })
    expect(screen.getByRole('status')).toHaveTextContent('API unavailable')
  })
})
