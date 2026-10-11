import { fireEvent, render, screen, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router'
import { beforeAll, describe, expect, it, vi } from 'vitest'
import { SessionContext, type SessionState } from './session'
import { AppRoutes } from '../App'
import { DataTable, ResourceFeedback } from '../components/ui'
import type { ResourceState } from '../types/domain'

beforeAll(() => {
  window.scrollTo = vi.fn()
  HTMLDialogElement.prototype.showModal = function () {
    this.setAttribute('open', '')
  }
  HTMLDialogElement.prototype.close = function () {
    this.removeAttribute('open')
  }
})
const authenticate = vi.fn().mockResolvedValue(undefined)
const mount = (route: string) => {
  vi.stubEnv('VITE_ENABLE_VISUAL_SAMPLES', 'true')
  const publicRoute = ['/', '/login', '/register'].includes(route)
  const value: SessionState = {
    status: publicRoute ? 'unauthenticated' : 'authenticated',
    user: publicRoute
      ? null
      : {
          id: 'test-user',
          email: 'analyst@example.com',
          display_name: 'Analyst',
          created_at: '2026-10-01',
        },
    message: '',
    refresh: vi.fn(),
    authenticate,
    logout: vi.fn(),
  }
  if (!vi.isMockFunction(globalThis.fetch))
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValue(
          new Response(
            JSON.stringify({
              data: {
                datasets: 0,
                research_runs: 0,
                ml_experiments: 0,
                reports: 0,
              },
              meta: { version: 'v1' },
              error: null,
            }),
          ),
        ),
    )
  return render(
    <MemoryRouter initialEntries={[route]}>
      <SessionContext.Provider value={value}>
        <AppRoutes />
      </SessionContext.Provider>
    </MemoryRouter>,
  )
}

describe('public landing page', () => {
  it('renders independently of the API and keeps future execution explicit', async () => {
    const fetch = vi.fn()
    vi.stubGlobal('fetch', fetch)
    mount('/')
    expect(await screen.findByRole('heading', { level: 1 })).toHaveTextContent(
      'From raw datato explainableintelligence.',
    )
    expect(
      screen.queryByRole('navigation', { name: 'Main navigation' }),
    ).not.toBeInTheDocument()
    expect(
      screen.getByText(/Data processing and AI execution are in development/),
    ).toBeInTheDocument()
    expect(
      screen.getByText(/No analysis or agent execution/),
    ).toBeInTheDocument()
    expect(
      screen.queryByRole('link', { name: /Explore Platform/ }),
    ).not.toBeInTheDocument()
    expect(fetch).not.toHaveBeenCalled()
  })
  it('exposes all seven planned roles with a single selected description', async () => {
    mount('/')
    const roles = await screen.findByRole('group', {
      name: 'Seven logical agent roles',
    })
    const buttons = within(roles).getAllByRole('button')
    expect(buttons).toHaveLength(7)
    for (const button of buttons) {
      fireEvent.click(button)
      expect(within(roles).getAllByRole('button', { pressed: true })).toEqual([
        button,
      ])
      expect(document.getElementById('agent-description')).toHaveTextContent(
        button.querySelector('strong')!.textContent!,
      )
    }
    expect(
      screen.getByRole('heading', {
        name: 'An explanation you can return to.',
      }),
    ).toBeInTheDocument()
    expect(screen.getByText(/not an eighth agent/)).toBeInTheDocument()
  })
  it.each([
    ['Get Started', 'Create your workspace'],
    ['Sign In', 'Welcome back.'],
  ])('connects %s to the existing public interface', async (label, heading) => {
    mount('/')
    fireEvent.click((await screen.findAllByRole('link', { name: label }))[0])
    expect(
      await screen.findByRole('heading', { name: heading }),
    ).toBeInTheDocument()
  })
})

describe('workspace routes', () => {
  it.each([
    ['/login', 'Welcome back.'],
    ['/register', 'Create your workspace'],
    ['/dashboard', 'A clearer view starts here.'],
    ['/datasets', 'Your datasets'],
    ['/datasets/not-connected', 'Dataset workspace'],
    ['/datasets/sample-retail/clean', 'Cleaning Studio'],
    ['/research/preview', 'Follow the reasoning.'],
    ['/analysis/sample-retail', 'Analytics workspace'],
    ['/models/preview', 'ML Studio'],
    ['/history', 'Reports & history'],
    ['/missing', 'Page not found'],
  ])('renders %s without claiming backend results', async (route, heading) => {
    mount(route)
    expect(
      await screen.findByRole('heading', { name: heading }),
    ).toBeInTheDocument()
  })
  it('navigates between authenticated workspace interfaces', async () => {
    mount('/dashboard')
    expect(
      await screen.findByRole('heading', {
        name: 'A clearer view starts here.',
      }),
    ).toBeInTheDocument()
    fireEvent.click(
      within(
        screen.getByRole('navigation', { name: 'Main navigation' }),
      ).getByRole('link', { name: 'Reports & History' }),
    )
    expect(
      await screen.findByRole('heading', { name: 'Reports & history' }),
    ).toBeInTheDocument()
  })
  it('validates registration and forwards only matching credentials to authentication', async () => {
    const fetch = vi.fn()
    vi.stubGlobal('fetch', fetch)
    mount('/register')
    fireEvent.click(screen.getByRole('button', { name: 'Create account' }))
    expect(screen.getByText('Enter a valid email address.')).toBeInTheDocument()
    fireEvent.change(screen.getByLabelText('Display name'), {
      target: { value: 'Analyst' },
    })
    fireEvent.change(screen.getByLabelText('Email address'), {
      target: { value: 'analyst@example.com' },
    })
    fireEvent.change(screen.getByLabelText('Password', { exact: true }), {
      target: { value: 'example-password' },
    })
    fireEvent.change(screen.getByLabelText('Confirm password'), {
      target: { value: 'different' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Create account' }))
    expect(screen.getByText('Passwords must match.')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Show password' }))
    expect(screen.getByLabelText('Password', { exact: true })).toHaveAttribute(
      'type',
      'text',
    )
    fireEvent.change(screen.getByLabelText('Confirm password'), {
      target: { value: 'example-password' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Create account' }))
    expect(authenticate).toHaveBeenCalledWith(true, {
      email: 'analyst@example.com',
      password: 'example-password',
      display_name: 'Analyst',
    })
    expect(fetch).not.toHaveBeenCalled()
  })
  it('loads a labeled sample, paginates it, and never uploads a selected file', async () => {
    const fetch = vi.fn()
    vi.stubGlobal('fetch', fetch)
    mount('/datasets/sample-retail')
    fireEvent.click(
      await screen.findByRole('button', { name: /Explore sample workspace/ }),
    )
    expect(
      await screen.findByRole('heading', { name: 'Retail operations' }),
    ).toBeInTheDocument()
    expect(screen.getByText('SO-1001')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Next page' }))
    expect(screen.getByText('SO-1007')).toBeInTheDocument()
    fireEvent.change(screen.getByLabelText('Choose dataset file'), {
      target: { files: [new File(['a,b'], 'local.csv', { type: 'text/csv' })] },
    })
    expect(screen.getByRole('status')).toHaveTextContent(
      'not read, sent or saved',
    )
    expect(fetch).not.toHaveBeenCalled()
  })
  it('keeps cleaning suggestions distinct from applied versions', async () => {
    mount('/datasets/sample-retail/clean')
    fireEvent.click(
      await screen.findByRole('button', { name: /Explore sample workspace/ }),
    )
    fireEvent.click(
      await screen.findByRole('button', { name: 'Preview approval' }),
    )
    expect(screen.getByRole('status')).toHaveTextContent(
      'Nothing was applied or saved',
    )
    expect(screen.getByText('No derived version created')).toBeInTheDocument()
    expect(
      screen.getByRole('button', { name: 'Apply approved plan' }),
    ).toBeDisabled()
  })
  it('filters, sorts and paginates local table rows', () => {
    render(
      <DataTable
        rows={[
          { id: 'a', value: 2 },
          { id: 'b', value: 1 },
          { id: 'c', value: 3 },
        ]}
        columns={[
          { key: 'id', label: 'ID' },
          { key: 'value', label: 'Value' },
        ]}
        caption="test records"
        pageSize={2}
      />,
    )
    fireEvent.click(screen.getByRole('button', { name: 'Value' }))
    expect(screen.getAllByRole('row')[1]).toHaveTextContent('b1')
    fireEvent.click(screen.getByRole('button', { name: 'Next page' }))
    expect(screen.getByText('c')).toBeInTheDocument()
    fireEvent.change(screen.getByRole('textbox'), {
      target: { value: 'no match' },
    })
    expect(screen.getByText(/No matching rows/)).toBeInTheDocument()
  })
})

describe('typed resource feedback', () => {
  const states: ResourceState<unknown>[] = [
    { kind: 'loading' },
    { kind: 'empty' },
    { kind: 'network' },
    { kind: 'unauthorized' },
    { kind: 'forbidden' },
    { kind: 'unsupported' },
    { kind: 'validation', message: 'Choose a valid target.' },
    { kind: 'failed', message: 'The job failed.' },
    { kind: 'running', progress: 40 },
  ]
  it.each(states)('renders a distinct $kind state', (state) => {
    render(<ResourceFeedback state={state} />)
    const feedback = screen.getByRole(
      state.kind === 'failed' || state.kind === 'validation'
        ? 'alert'
        : 'status',
    )
    expect(feedback).not.toBeEmptyDOMElement()
    if (state.kind === 'running')
      expect(screen.getByRole('progressbar')).toHaveAttribute('value', '40')
  })
})
