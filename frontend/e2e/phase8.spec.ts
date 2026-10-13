import { expect, test } from '@playwright/test'
import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { registerAccount } from './account'

test('local reference research produces a verified comparison and downloadable report', async ({ page }, testInfo) => {
  test.setTimeout(300_000)
  const pageErrors: string[] = []
  page.on('pageerror', (error) => pageErrors.push(error.message))
  await registerAccount(page, 'Phase 8 research analyst')

  await page.goto('/datasets')
  const csv = [
    'id,region,product,revenue,profit',
    '1,North,standard,500,100',
    '2,North,standard,600,300',
    '3,South,standard,12000,8000',
    '4,South,standard,13000,9000',
    '',
  ].join('\n')
  await page.getByLabel('Choose dataset file').setInputFiles({
    name: 'phase8-sales.csv',
    mimeType: 'text/csv',
    buffer: Buffer.from(csv),
  })
  await page.getByRole('button', { name: 'Upload dataset' }).click()
  await expect(page.getByText('ready', { exact: true })).toBeVisible({ timeout: 30_000 })
  const datasetId = new URL(page.url()).pathname.split('/').at(-1)!

  await page.goto('/knowledge')
  const reference = 'South region:\nTarget average profit: 10000.'
  await page.getByLabel('Choose a reference document').setInputFiles({
    name: 'regional-target.txt',
    mimeType: 'text/plain',
    buffer: Buffer.from(reference),
  })
  await expect(page.getByText('regional-target.txt')).toBeVisible({ timeout: 15_000 })
  await expect(page.getByText('indexed', { exact: true })).toBeVisible({ timeout: 90_000 })

  await page.goto(`/research/${datasetId}`)
  await page.getByLabel('Research question').fill(
    "Compare South's actual mean profit with its target in the selected document. Report the shortfall, percentage below target, achievement percentage, and cite both sources.",
  )
  await page.getByLabel('regional-target.txt').check()
  const planning = page.waitForResponse((response) => response.request().method() === 'POST' && new URL(response.url()).pathname === '/api/v1/research', { timeout: 180_000 })
  await page.getByRole('button', { name: 'Generate research plan' }).click()
  const planned = (await (await planning).json()).data
  expect(planned.status, planned.failure ?? 'Research planning did not reach approval').toBe('awaiting_approval')
  await expect(page.getByRole('button', { name: 'Approve exact plan' })).toBeVisible({ timeout: 180_000 })
  await expect(page.getByText('retrieve_documents')).toBeVisible()
  await page.getByRole('button', { name: 'Approve exact plan' }).click()
  await page.getByRole('button', { name: 'Start investigation' }).click()
  await expect(page.locator('.research-results > section.panel').first().locator('.panel-heading .badge')).toHaveText('completed', { timeout: 120_000 })
  await expect(page.locator('.research-final li').filter({ hasText: 'South has the highest average profit: 8,500.' })).toBeVisible()
  await expect(page.locator('.research-final .research-evidence').filter({ hasText: 'regional-target.txt' })).toBeVisible()
  const answer = "South's actual average profit was 8,500 against a documented target of 10,000. The region fell short by 1,500, or 15% below target, achieving 85% of its target."
  await expect(page.locator('.research-final > p').first()).toHaveText(answer)
  await expect(page.getByText('Target not met', { exact: true })).toBeVisible()
  await expect(page.locator('.research-final')).toContainText('Dataset evidence')
  await expect(page.locator('.research-final')).toContainText('document evidence')
  const runs = await page.request.get('/api/v1/research')
  const completed = (await runs.json()).data.find((run: { status: string }) => run.status === 'completed')
  const synthesis = completed.evidence.find((item: { evidence_type: string }) => item.evidence_type === 'synthesize_evidence').payload.result
  expect(synthesis.comparisons[0]).toMatchObject({ actual_value: 8500, target_value: 10000, difference: -1500, percentage_difference: -15, percentage_of_target: 85, target_met: false, claim: answer })
  expect(synthesis.comparisons[0]).toMatchObject({ metric_column_id: 'column_005', group_column_id: 'column_002' })
  expect(synthesis.comparisons[0].citations[0].excerpt).toBe(reference)
  const reopened = await page.request.get(`/api/v1/research/${completed.id}`)
  expect((await reopened.json()).data.evidence.find((item: { evidence_type: string }) => item.evidence_type === 'synthesize_evidence').payload.result.comparisons).toEqual(synthesis.comparisons)

  await page.getByRole('button', { name: 'Generate PDF report' }).click()
  await expect(page.getByRole('status')).toContainText('Report queued', { timeout: 15_000 })
  await page.getByRole('link', { name: 'Open Reports & History' }).click()
  await expect(page.getByRole('heading', { name: 'Reports & history' })).toBeVisible()
  const download = page.waitForEvent('download')
  await page.getByRole('button', { name: /Download report for/ }).click({ timeout: 90_000 })
  const downloaded = await download
  expect(downloaded.suggestedFilename()).toMatch(/\.pdf$/)
  const pdfPath = testInfo.outputPath('comparison-report.pdf')
  await downloaded.saveAs(pdfPath)
  const python = fileURLToPath(new URL(process.platform === 'win32' ? '../../backend/.venv/Scripts/python.exe' : '../../backend/.venv/bin/python', import.meta.url))
  const text = execFileSync(python, ['-c', 'import sys; from pypdf import PdfReader; print(" ".join(" ".join(p.extract_text() for p in PdfReader(sys.argv[1]).pages).split()))', pdfPath], { encoding: 'utf8' })
  for (const [section, end] of [['Executive summary', 'Verified findings'], ['Verified findings', 'Methodology'], ['Conclusion', '']]) {
    const sectionText = text.split(section)[1]
    expect(end ? sectionText.split(end)[0] : sectionText).toContain(answer)
  }
  const citationText = text.replace(/\s/g, '')
  expect(citationText).toContain(synthesis.comparisons[0].dataset_evidence_id)
  expect(citationText).toContain(synthesis.comparisons[0].citations[0].evidence_id)
  expect(citationText).toContain(synthesis.comparisons[0].citations[0].chunk_id)
  expect(text).toContain('regional-target.txt')
  expect(pageErrors).toEqual([])
})
