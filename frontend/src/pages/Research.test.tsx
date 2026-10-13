import { fireEvent, render, screen, within } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router'
import { describe, expect, it, vi } from 'vitest'
import Research from './Research'

const datasetId = '11111111-1111-4111-8111-111111111111'
const answer = "South's actual average profit was 8,500 against a documented target of 10,000. The region fell short by 1,500, or 15% below target, achieving 85% of its target."

async function openSavedRun(withComparison: boolean) {
  const run = {
    id: 'saved-run', dataset_id: datasetId, dataset_version_id: 'version-2',
    status: 'completed', question: 'Compare South average profit with its target.',
    created_at: '2026-10-11T10:00:00Z', plan: { steps: [] }, steps: [],
    approval: { status: 'approved' }, revision_count: 0,
    evidence: [{ id: 'synthesis-evidence', evidence_type: 'synthesize_evidence', payload: {
      result: {
        interpretation: withComparison ? answer : 'Calculated average profit by region.',
        findings: [{ claim: 'South has the highest average profit: 8,500.', evidence_id: 'dataset-evidence', exact: true }],
        ...(withComparison ? { comparisons: [{
          claim: answer, dataset_evidence_id: 'dataset-evidence', dataset_version_id: 'version-2',
          target_met: false, citations: [{ source_filename: 'regional-target.txt', page_number: null,
            chunk_id: 'real-chunk', evidence_id: 'document-evidence', excerpt: 'South target average profit: 10,000.' }],
        }] } : {}),
      },
    } }],
  }
  vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
    const path = String(input)
    const data = path.includes('/datasets?page') ? { items: [{ id: datasetId, display_name: 'Sales', status: 'ready' }] }
      : path.endsWith('/versions') ? [{ id: 'version-2', version_no: 2 }]
      : path.endsWith('/documents') ? []
      : path.endsWith('/research') ? [run] : run
    return new Response(JSON.stringify({ data, meta: { version: 'v1' }, error: null }))
  }))
  render(<MemoryRouter initialEntries={[`/research/${datasetId}`]}><Routes><Route path="/research/:id" element={<Research />} /></Routes></MemoryRouter>)
  await screen.findByRole('option', { name: 'Sales' })
  fireEvent.click(screen.getByRole('button', { name: 'Research history' }))
  fireEvent.click(await screen.findByRole('button', { name: /Compare South average profit/ }))
  await screen.findByRole('button', { name: 'Generate PDF report' })
}

describe('persisted research comparisons', () => {
  it('shows the saved answer, target status and both evidence references when reopened', async () => {
    await openSavedRun(true)
    const findings = within(screen.getByText('Verified findings and evidence').closest('section')!)
    expect(findings.getAllByText(answer).length).toBeGreaterThan(0)
    expect(findings.getByText('Target not met')).toBeVisible()
    expect(findings.getByText(/Dataset evidence dataset-evidence/)).toBeVisible()
    expect(findings.getByText(/regional-target.txt.*document evidence document-evidence/)).toBeVisible()
    expect(findings.getByText('South target average profit: 10,000.')).toBeVisible()
  })

  it('does not invent a comparison for a historical result without one', async () => {
    await openSavedRun(false)
    expect(screen.getByText('Calculated average profit by region.')).toBeVisible()
    expect(screen.queryByText('Target not met')).not.toBeInTheDocument()
    expect(screen.queryByText(answer)).not.toBeInTheDocument()
  })
})
