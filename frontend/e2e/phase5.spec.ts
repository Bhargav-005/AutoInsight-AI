import { expect, test } from '@playwright/test'
import { registerAccount } from './account'

test('numeric integer columns can use median in a cleaning preview', async ({ page }) => {
  test.setTimeout(60_000)
  await registerAccount(page, 'Median cleaning analyst')
  await page.goto('/datasets')
  await page.getByLabel('Choose dataset file').setInputFiles({
    name: 'median-orders.csv',
    mimeType: 'text/csv',
    buffer: Buffer.from([
      'order_id,region,product,sales,profit',
      '1,East,A,100,20',
      '2,East,B,200,40',
      '3,West,A,50,10',
      '3,West,A,50,10',
      '4,West,B,,30',
      '5,East,A,150,',
      '6,West,C,250,50',
      '',
    ].join('\n')),
  })
  await page.getByRole('button', { name: 'Upload dataset' }).click()
  await expect(page.getByText('ready', { exact: true })).toBeVisible({ timeout: 30_000 })
  const datasetId = new URL(page.url()).pathname.split('/').at(-1)!
  expect(datasetId).toMatch(/^[0-9a-f-]{36}$/i)

  await page.goto(`/datasets/${datasetId}/clean`)
  await expect(page.locator('.stat-card').first()).toContainText('Missing values')
  await page.getByRole('button', { name: 'Add operation' }).click()
  await page.getByLabel('Cleaning operation').selectOption('fill_missing')
  await page.getByLabel('Cleaning column').selectOption('column_004')
  await expect(page.getByLabel('Cleaning column').locator('option:checked')).toHaveText('sales · integer')
  const medianOption = page.getByLabel('Fill method').locator('option[value="median"]')
  await expect(medianOption).toBeEnabled()
  await page.getByLabel('Fill method').selectOption('median')
  await page.getByRole('button', { name: 'Add operation' }).click()

  await page.getByLabel('Cleaning column').selectOption('column_005')
  await expect(page.getByLabel('Cleaning column').locator('option:checked')).toHaveText('profit · integer')
  await expect(page.getByLabel('Fill method')).toHaveValue('median')
  await expect(medianOption).toBeEnabled()
  await page.getByRole('button', { name: 'Add operation' }).click()
  await expect(page.locator('.clean-operation-list')).toContainText('Remove exact duplicate rows')
  await expect(page.locator('.clean-operation-list')).toContainText('Fill missing values · sales · median')
  await expect(page.locator('.clean-operation-list')).toContainText('Fill missing values · profit · median')

  await page.getByRole('button', { name: 'Preview plan' }).click()
  await expect(page.getByText('7 → 6', { exact: true })).toBeVisible({ timeout: 30_000 })
  await expect(page.getByText('2 → 0', { exact: true })).toBeVisible()
  await expect(page.getByText('1 → 0', { exact: true })).toBeVisible()

  const approval = page.getByRole('checkbox', { name: /I reviewed this preview/ })
  await approval.focus()
  await page.keyboard.press('Space')
  await expect(approval).toBeChecked()
  await page.locator('.approval-check span').click()
  await expect(approval).not.toBeChecked()
  for (const width of [320, 375, 768, 1024, 1440]) {
    await page.setViewportSize({ width, height: 900 })
    const layout = await page.evaluate(() => {
      const label = document.querySelector('.approval-check')!
      const checkbox = label.querySelector('input')!
      const text = label.querySelector('span')!
      const range = document.createRange()
      range.selectNodeContents(text)
      return {
        labelWidth: label.getBoundingClientRect().width,
        checkboxWidth: checkbox.getBoundingClientRect().width,
        textWidth: text.getBoundingClientRect().width,
        textLines: range.getClientRects().length,
      }
    })
    expect(layout.checkboxWidth, `checkbox remains visible at ${width}px`).toBeGreaterThanOrEqual(17)
    expect(layout.textWidth, `approval text has room at ${width}px`).toBeGreaterThan(100)
    expect(layout.textLines, `approval text wraps naturally at ${width}px`).toBeLessThanOrEqual(3)
    expect(layout.labelWidth, `approval label has usable width at ${width}px`).toBeGreaterThan(150)
  }
})

test('a genuine uploaded dataset can be cleaned, versioned and analyzed', async ({ page }) => {
  test.setTimeout(60_000)
  await registerAccount(page, 'Phase 5 analyst')
  await page.goto('/datasets')
  await page.getByLabel('Choose dataset file').setInputFiles({
    name: 'phase5-orders.csv',
    mimeType: 'text/csv',
    buffer: Buffer.from([
      'order_id,region,product,sales,profit',
      '1,East,A,100,20',
      '2,East,B,200,40',
      '3,West,A,50,10',
      '3,West,A,50,10',
      '4,West,B,,30',
      '5,East,A,150,',
      '',
    ].join('\n')),
  })
  await page.getByRole('button', { name: 'Upload dataset' }).click()
  await expect(page.getByText('ready', { exact: true })).toBeVisible({ timeout: 30_000 })
  const datasetId = new URL(page.url()).pathname.split('/').at(-1)!
  expect(datasetId).toMatch(/^[0-9a-f-]{36}$/i)

  await page.goto(`/datasets/${datasetId}/clean`)
  await expect(page.locator('.stat-card').first()).toContainText('Missing values')
  await page.getByRole('button', { name: 'Use suggestions' }).click()
  await page.getByRole('button', { name: 'Preview plan' }).click()
  await expect(page.getByText(/6 → 5/)).toBeVisible()

  for (const width of [320, 375, 768, 1024, 1280, 1440]) {
    await page.setViewportSize({ width, height: 900 })
    await expect.poll(
      () => page.evaluate(() => document.documentElement.scrollWidth),
      { timeout: 3_000 },
    ).toBeLessThanOrEqual(width)
    const layout = await page.evaluate(() => {
      const root = document.querySelector('.cleaning-layout')
      const comparison = root?.querySelector('.comparison')
      const tableRegions = [...(comparison?.querySelectorAll('.table-scroll') ?? [])]
      const controls = [...(root?.querySelectorAll('button, input, select') ?? [])]
        .filter((element) => element.getClientRects().length > 0 && !element.closest('.table-scroll'))
      return {
        pageWidth: document.documentElement.scrollWidth,
        viewportWidth: window.innerWidth,
        tableRegions: tableRegions.map((element) => ({
          left: element.getBoundingClientRect().left,
          right: element.getBoundingClientRect().right,
          paneLeft: element.parentElement?.getBoundingClientRect().left ?? 0,
          paneRight: element.parentElement?.getBoundingClientRect().right ?? 0,
        })),
        controlsOutsideViewport: controls.some((element) => {
          const rect = element.getBoundingClientRect()
          return rect.left < -1 || rect.right > window.innerWidth + 1
        }),
      }
    })
    expect(layout.pageWidth, `page overflow at ${width}px`).toBeLessThanOrEqual(layout.viewportWidth)
    expect(layout.tableRegions, `both comparison tables present at ${width}px`).toHaveLength(2)
    expect(layout.tableRegions.every((region) => region.left >= region.paneLeft - 1 && region.right <= region.paneRight + 1 && region.left >= -1 && region.right <= width + 1), `table panels stay within their panes at ${width}px`).toBe(true)
    expect(layout.controlsOutsideViewport, `cleaning controls stay visible at ${width}px`).toBe(false)
  }
  await page.setViewportSize({ width: 1280, height: 900 })

  await page.getByLabel(/I reviewed this preview/).check()
  await page.getByRole('button', { name: 'Approve and apply plan' }).click()
  await expect(page.getByRole('status')).toContainText('completed', { timeout: 30_000 })
  await expect(page.getByText(/created version 2/)).toBeVisible()

  await page.goto(`/analysis/${datasetId}`)
  await expect(page.getByRole('heading', { name: 'Analytics workspace' })).toBeVisible()
  await expect(page.getByText('5 rows · 5 columns · exact')).toBeVisible()
  await page.getByLabel('Aggregate metric').selectOption('column_004')
  await page.getByRole('button', { name: 'Calculate', exact: true }).click()
  await expect(page.getByRole('table', { name: 'Grouped aggregate results' })).toContainText('East')
  await expect(page.getByRole('table', { name: 'Grouped aggregate results' })).toContainText('450')
  await page.getByRole('button', { name: 'Build chart' }).click()
  await expect(page.getByRole('table', { name: 'Chart data' })).toContainText('West')
  await page.getByRole('button', { name: 'Calculate correlation' }).click()
  await expect(page.getByRole('table', { name: 'Correlation matrix' })).toBeVisible()
})
