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
      vi.fn((input: RequestInfo | URL) => {
        const url = String(input)
        const error = { code: 'DATASET_NOT_FOUND', message: 'Dataset not found.' }
        const data = url.endsWith('/documents') || url.endsWith('/reports')
          ? []
          : url.endsWith('/datasets?page=1&page_size=20')
          ? { items: [], page: 1, page_size: 100, total: 0 }
          : url.includes('/datasets/')
            ? null
            : { datasets: 0, research_runs: 0, ml_experiments: 0, reports: 0 }
        return Promise.resolve(new Response(JSON.stringify({
          data,
          meta: { version: 'v1' },
          error: data === null ? error : null,
        }), { status: data === null ? 404 : 200 }))
      }),
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
    expect(screen.getByText('An interactive product walkthrough')).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: /Your workflow/ })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: /Depth at every step/ })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: /A process you can follow/ })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: /Seven roles/ })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: /Built close to your data/ })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: /A clearer view of your data/ })).toBeInTheDocument()
    expect(screen.getByRole('contentinfo')).toBeInTheDocument()
    expect(
      screen.queryByRole('link', { name: /Explore Platform/ }),
    ).not.toBeInTheDocument()
    expect(fetch).not.toHaveBeenCalled()
  })
  it('exposes all seven planned roles with a single selected description', async () => {
    mount('/')
    const roles = await screen.findByRole('tablist', {
      name: 'Seven logical agent roles',
    })
    const buttons = within(roles).getAllByRole('tab')
    expect(buttons).toHaveLength(7)
    for (const button of buttons) {
      fireEvent.click(button)
      expect(within(roles).getAllByRole('tab', { selected: true })).toEqual([
        button,
      ])
      expect(button).toHaveAttribute('aria-controls', 'agent-description')
      expect(document.getElementById('agent-description')).toHaveTextContent(button.querySelector('strong')!.textContent!)
    }
    expect(
      screen.getByRole('heading', {
        name: 'An explanation you can return to.',
      }),
    ).toBeInTheDocument()
    expect(screen.getByText(/Seven logical roles within one governed workflow/)).toBeInTheDocument()
  })
  it('opens a useful product walkthrough from the hero', async () => {
    mount('/')
    fireEvent.click(await screen.findByRole('button', { name: /Watch Video/ }))
    expect(screen.getByRole('dialog', { name: 'Product walkthrough' })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Start with a dataset' })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /Open Datasets/ })).toHaveAttribute('href', '/datasets')
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
    ['/datasets/not-connected', 'Choose a dataset'],
    ['/datasets/sample-retail/clean', 'Choose a dataset'],
    ['/research/preview', 'Follow the reasoning.'],
    ['/analysis/sample-retail', 'Choose a dataset'],
    ['/models/preview', 'ML Studio'],
    ['/history', 'Reports & history'],
    ['/knowledge', 'Knowledge Base'],
    ['/missing', 'Page not found'],
  ])('renders %s without claiming backend results', async (route, heading) => {
    mount(route)
    expect(
      await screen.findByRole('heading', { name: heading }, { timeout: 5000 }),
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
  it('lists only account datasets and waits for explicit upload submission', async () => {
    const fetch = vi.fn((input: RequestInfo | URL) => {
      const url = String(input)
      const data = url.endsWith('/datasets?page=1&page_size=20')
        ? {
            items: [{
              id: 'c0a80101-0000-4000-8000-000000000002',
              display_name: 'Account source',
              original_filename: 'account.csv',
              source_format: 'csv',
              file_size_bytes: 12,
              created_at: '2026-10-01T00:00:00Z',
              status: 'ready',
              selected_sheet: null,
              row_count: 1,
              column_count: 2,
            }],
            page: 1,
            page_size: 100,
            total: 1,
          }
        : { datasets: 0, research_runs: 0, ml_experiments: 0, reports: 0 }
      return Promise.resolve(new Response(JSON.stringify({
        data,
        meta: { version: 'v1' },
        error: null,
      })))
    })
    vi.stubGlobal('fetch', fetch)
    mount('/datasets')
    expect(await screen.findByRole('heading', { name: 'Your datasets' })).toBeInTheDocument()
    expect(await screen.findByRole('link', { name: 'Open Account source details' })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Open Cleaning Studio' })).toHaveAttribute(
      'href',
      '/datasets/c0a80101-0000-4000-8000-000000000002/clean',
    )
    fireEvent.change(screen.getByLabelText('Choose dataset file'), {
      target: { files: [new File(['a,b'], 'local.csv', { type: 'text/csv' })] },
    })
    expect(screen.getByRole('button', { name: 'Upload dataset' })).toBeInTheDocument()
    expect(fetch.mock.calls.every(([input]) => !String(input).includes('/auth/'))).toBe(true)
  })
  it('opens valid owned datasets from the library, sidebar and dataset selector', async () => {
    const id = 'c0a80101-0000-4000-8000-000000000001'
    const dataset = {
      id,
      display_name: 'Quarterly sales',
      original_filename: 'sales.csv',
      source_format: 'csv',
      file_size_bytes: 128,
      created_at: '2026-10-01T00:00:00Z',
      status: 'ready',
      selected_sheet: null,
      row_count: 12,
      column_count: 3,
    }
    const fetch = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input)
      let data: unknown = null
      if (url.endsWith('/datasets?page=1&page_size=20'))
        data = { items: [dataset], page: 1, page_size: 20, total: 1 }
      else if (url.endsWith(`/datasets/${id}`)) data = dataset
      else if (url.endsWith(`/datasets/${id}/versions`)) data = []
      return new Response(JSON.stringify({
        data,
        meta: { version: 'v1' },
        error: data === null ? { code: 'NOT_FOUND', message: 'Not found.' } : null,
      }), { status: data === null ? 404 : 200 })
    })
    vi.stubGlobal('fetch', fetch)
    mount('/datasets')

    const cleaningAction = await screen.findByRole('link', { name: 'Open Cleaning Studio' })
    expect(cleaningAction).toHaveAttribute('href', `/datasets/${id}/clean`)
    const cleaningNav = await screen.findByRole('link', { name: 'Cleaning Studio' })
    expect(cleaningNav).toHaveAttribute('href', `/datasets/${id}/clean`)
    expect(await screen.findByRole('combobox', { name: 'Dataset context' })).toHaveValue(id)

    fireEvent.click(cleaningNav)
    expect(await screen.findByRole('heading', { name: 'Cleaning Studio' })).toBeInTheDocument()
    expect(fetch.mock.calls.some(([input]) => String(input).includes(`/datasets/${id}`))).toBe(true)

    const analyticsNav = screen.getByRole('link', { name: 'Analytics' })
    expect(analyticsNav).toHaveAttribute('href', `/analysis/${id}`)
    fireEvent.click(analyticsNav)
    expect(await screen.findByRole('heading', { name: 'Analytics workspace' })).toBeInTheDocument()
    expect(screen.getByRole('combobox', { name: 'Dataset context' })).toHaveValue(id)
    expect(fetch.mock.calls.every(([input]) => !String(input).includes('sample-retail'))).toBe(true)
  })
  it('does not send placeholder IDs to the API and offers a dataset picker', async () => {
    const fetch = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input)
      const data = url.endsWith('/datasets?page=1&page_size=20')
        ? { items: [], page: 1, page_size: 20, total: 0 }
        : { datasets: 0, research_runs: 0, ml_experiments: 0, reports: 0 }
      return new Response(JSON.stringify({ data, meta: { version: 'v1' }, error: null }), { status: 200 })
    })
    vi.stubGlobal('fetch', fetch)
    mount('/datasets/sample-retail/clean')
    expect(await screen.findByRole('heading', { name: 'Choose a dataset' })).toBeInTheDocument()
    const datasetLinks = await screen.findAllByRole('link', { name: 'Browse datasets' })
    expect(datasetLinks.every((link) => link.getAttribute('href') === '/datasets')).toBe(true)
    expect(fetch.mock.calls.every(([input]) => !String(input).includes('/sample-retail'))).toBe(true)
  })
  it('previews a server-backed cleaning plan without creating a version', async () => {
    const id = 'c0a80101-0000-4000-8000-000000000001'
    const version = {
      id: 'version-1', version_no: 1, kind: 'raw', created_at: '2026-10-01',
      file_size_bytes: 20, checksum: 'a'.repeat(64), mime_type: 'text/csv',
    }
    const fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      let data: unknown = null
      if (url.endsWith(`/datasets/${id}`))
        data = { id, display_name: 'Test dataset', original_filename: 'test.csv', source_format: 'csv', file_size_bytes: 20, created_at: '2026-10-01', status: 'ready', selected_sheet: null, row_count: 2, column_count: 2 }
      else if (url.endsWith(`/datasets/${id}/versions`)) data = [version]
      else if (url.includes('/profile?version_id='))
        data = { row_count: 2, column_count: 2, columns: [{ id: 'column_001', name: 'Region', data_type: 'string', missing_count: 1, missing_percent: 50, distinct_count: 2, distinct_count_is_exact: true, sample_values: ['East'], numeric_summary: null }, { id: 'column_002', name: 'Sales', data_type: 'number', missing_count: 0, missing_percent: 0, distinct_count: 2, distinct_count_is_exact: true, sample_values: [10, 20], numeric_summary: null }], duplicate_row_count: 0, quality_summary: { missing_cell_count: 1, missing_cell_percent: 25, columns_with_missing_values: 1, duplicate_row_count: 0 }, methodology: {}, selected_sheet: null }
      else if (url.endsWith('/cleaning/suggestions'))
        data = { dataset_id: id, dataset_version_id: 'version-1', missing_cells: 1, duplicate_rows: 0, operations: [{ op: 'fill_missing', column: 'column_001', strategy: 'constant', value: 'Unknown' }], notes: [] }
      else if (url.endsWith('/auth/csrf')) data = { csrf_token: 'c'.repeat(64) }
      else if (url.endsWith('/cleaning/plans') && init?.method === 'POST')
        data = { id: 'plan-1', dataset_version_id: 'version-1', state: 'draft', operations: [], preview: null, job_id: null, attempt_count: 0, result_version_id: null, error_message: null }
      else if (url.endsWith('/plans/plan-1/preview'))
        data = { id: 'plan-1', dataset_version_id: 'version-1', state: 'previewed', operations: [], preview: { source_rows: 2, result_rows: 2, rows_removed: 0, source_missing_cells: 1, result_missing_cells: 0, source_duplicate_rows: 0, result_duplicate_rows: 0, before: [{ Region: null, Sales: 10 }], after: [{ Region: 'Unknown', Sales: 10 }], warnings: ['Preview is read-only; no artifact or dataset version was created.'] }, job_id: null, attempt_count: 0, result_version_id: null, error_message: null }
      return new Response(JSON.stringify({ data, meta: { version: 'v1' }, error: data === null ? { code: 'NOT_FOUND', message: 'Not found.' } : null }), { status: data === null ? 404 : 200 })
    })
    vi.stubGlobal('fetch', fetch)
    mount(`/datasets/${id}/clean`)
    fireEvent.click(await screen.findByRole('button', { name: 'Use suggestions' }))
    fireEvent.click(screen.getByRole('button', { name: 'Preview plan' }))
    expect(await screen.findByText('Preview is read-only; no artifact or dataset version was created.')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Approve and apply plan' })).toBeDisabled()
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
