import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from '@testing-library/react'
import { MemoryRouter } from 'react-router'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { AppRoutes } from '../App'
import SessionProvider from './SessionProvider'
import { safeDestination } from './session'

const user = {
  id: 'account-a',
  email: 'analyst@example.com',
  display_name: 'Real Analyst',
  created_at: '2026-10-01T00:00:00Z',
}
const ok = (data: unknown, status = 200) =>
  new Response(JSON.stringify({ data, meta: { version: 'v1' }, error: null }), {
    status,
  })
const fail = (status: number, message: string) =>
  new Response(
    JSON.stringify({
      data: null,
      meta: { version: 'v1' },
      error: { code: 'TEST_ERROR', message },
    }),
    { status },
  )
let signedIn = false
let outage = false
let overviewFailure = false
let logoutFailure = false
let expired = false
let requests: ReturnType<typeof vi.fn>

beforeEach(() => {
  signedIn = outage = overviewFailure = logoutFailure = expired = false
  window.scrollTo = vi.fn()
  HTMLDialogElement.prototype.showModal = function () {
    this.setAttribute('open', '')
  }
  HTMLDialogElement.prototype.close = function () {
    this.removeAttribute('open')
  }
  requests = vi.fn(async (url: string, init?: RequestInit) => {
    if (outage) throw new TypeError('offline')
    if (url.endsWith('/auth/me'))
      return signedIn ? ok(user) : fail(401, 'Sign in required')
    if (url.endsWith('/auth/csrf')) return ok({ csrf_token: 'csrf-proof' })
    if (url.endsWith('/auth/register') || url.endsWith('/auth/login')) {
      if (JSON.parse(String(init?.body)).password === 'wrong-password')
        return fail(401, 'Email or password is incorrect.')
      signedIn = true
      return ok(user, url.endsWith('/register') ? 201 : 200)
    }
    if (url.endsWith('/auth/logout')) {
      if (logoutFailure) return fail(503, 'Logout unavailable')
      signedIn = false
      return ok({ logged_out: true })
    }
    if (url.endsWith('/dashboard/overview')) {
      if (expired) return fail(401, 'Session expired')
      if (overviewFailure) return fail(503, 'Statistics unavailable')
      return ok({
        datasets: 0,
        research_runs: 0,
        ml_experiments: 0,
        reports: 0,
      })
    }
    throw new Error(`Unexpected URL ${url}`)
  })
  vi.stubGlobal('fetch', requests)
})
const mount = (path: string) =>
  render(
    <MemoryRouter initialEntries={[path]}>
      <SessionProvider>
        <AppRoutes />
      </SessionProvider>
    </MemoryRouter>,
  )
const fill = (password = 'a long test passphrase') => {
  fireEvent.change(screen.getByLabelText('Email address'), {
    target: { value: user.email },
  })
  fireEvent.change(screen.getByLabelText('Password', { exact: true }), {
    target: { value: password },
  })
}

describe('real authentication integration', () => {
  it('registers only valid matching credentials, uses CSRF and shows real zero counts', async () => {
    mount('/register')
    fireEvent.click(
      await screen.findByRole('button', { name: 'Create account' }),
    )
    expect(
      requests.mock.calls.filter(([, init]) => init?.method === 'POST'),
    ).toHaveLength(0)
    fireEvent.change(screen.getByLabelText('Display name'), {
      target: { value: user.display_name },
    })
    fill()
    fireEvent.change(screen.getByLabelText('Confirm password'), {
      target: { value: 'mismatch' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Create account' }))
    expect(screen.getByText('Passwords must match.')).toBeInTheDocument()
    fireEvent.change(screen.getByLabelText('Confirm password'), {
      target: { value: 'a long test passphrase' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Create account' }))
    expect(
      await screen.findByRole('heading', {
        name: 'A clearer view starts here.',
      }),
    ).toBeInTheDocument()
    await waitFor(() =>
      expect(document.querySelectorAll('.stat-card strong')).toHaveLength(4),
    )
    await waitFor(() =>
      expect(
        [...document.querySelectorAll('.stat-card strong')].map(
          (node) => node.textContent,
        ),
      ).toEqual(['0', '0', '0', '0']),
    )
    const call = requests.mock.calls.find(([url]) =>
      url.endsWith('/auth/register'),
    )!
    expect(call[1]).toMatchObject({
      credentials: 'same-origin',
      headers: { 'X-CSRF-Token': 'csrf-proof' },
    })
    expect(localStorage.length).toBe(0)
    expect(sessionStorage.length).toBe(0)
  })
  it('redirects protected routes, rejects incorrect credentials and restores the intended route', async () => {
    mount('/datasets')
    expect(
      await screen.findByRole('heading', { name: 'Welcome back.' }),
    ).toBeInTheDocument()
    fill('wrong-password')
    fireEvent.click(screen.getByRole('button', { name: 'Sign in' }))
    expect(
      await screen.findByText('Email or password is incorrect.'),
    ).toBeInTheDocument()
    fill()
    fireEvent.click(screen.getByRole('button', { name: 'Sign in' }))
    expect(
      await screen.findByRole('heading', { name: 'Your datasets' }),
    ).toBeInTheDocument()
    for (const destination of [
      '//evil.example',
      '/\\evil.example',
      'https://evil.example',
      '/login',
    ])
      expect(safeDestination(destination)).toBe('/dashboard')
  })
  it('restores a valid session on reload and clears private state only after confirmed logout', async () => {
    signedIn = true
    const first = mount('/dashboard')
    expect(await screen.findByText(/Welcome, Real Analyst/)).toBeInTheDocument()
    first.unmount()
    mount('/dashboard')
    fireEvent.click(
      await screen.findByRole('button', { name: 'Open account information' }),
    )
    const dialog = screen.getByRole('dialog', {
      name: 'Your workspace account',
    })
    expect(within(dialog).getByText(user.email)).toBeInTheDocument()
    logoutFailure = true
    fireEvent.click(within(dialog).getByRole('button', { name: 'Sign out' }))
    expect(
      await screen.findByText(/Your session has not been confirmed as revoked/),
    ).toBeInTheDocument()
    logoutFailure = false
    fireEvent.click(within(dialog).getByRole('button', { name: 'Sign out' }))
    expect(
      await screen.findByRole('heading', { name: 'Welcome back.' }),
    ).toBeInTheDocument()
    expect(screen.queryByText(user.email)).not.toBeInTheDocument()
    expect(
      screen.queryByRole('navigation', { name: 'Main navigation' }),
    ).not.toBeInTheDocument()
  })
  it('shows an expired-session message when a protected API rejects the session', async () => {
    signedIn = true
    expired = true
    mount('/dashboard')
    expect(
      await screen.findByText('Your session expired. Please sign in again.'),
    ).toBeInTheDocument()
    expect(screen.queryByText(/Welcome, Real Analyst/)).not.toBeInTheDocument()
  })
  it('recovers from an outage without inventing zero counts', async () => {
    outage = true
    mount('/dashboard')
    expect(
      await screen.findByText('Your workspace is temporarily unavailable.'),
    ).toBeInTheDocument()
    outage = false
    signedIn = true
    overviewFailure = true
    fireEvent.click(screen.getByRole('button', { name: 'Retry connection' }))
    expect(
      await screen.findByText(/Account statistics are unavailable/),
    ).toBeInTheDocument()
    expect(
      [...document.querySelectorAll('.stat-card strong')].map(
        (node) => node.textContent,
      ),
    ).toEqual(['—', '—', '—', '—'])
    overviewFailure = false
    fireEvent.click(screen.getByRole('button', { name: 'Retry overview' }))
    await waitFor(() =>
      expect(
        [...document.querySelectorAll('.stat-card strong')].map(
          (node) => node.textContent,
        ),
      ).toEqual(['0', '0', '0', '0']),
    )
  })
})
