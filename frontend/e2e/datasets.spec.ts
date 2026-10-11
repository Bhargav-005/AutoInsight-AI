import { expect, test } from '@playwright/test'
import { registerAccount } from './account'

test('Phase 4 CSV upload reaches the owner profile and paginated preview', async ({ page }) => {
  await registerAccount(page, 'Phase 4 browser dataset')
  await page.goto('/datasets')
  await expect(page.getByRole('heading', { name: 'Your datasets' })).toBeVisible()

  await page.getByLabel('Choose dataset file').setInputFiles({
    name: 'browser-sales.csv',
    mimeType: 'text/csv',
    buffer: Buffer.from('amount,region\n12,East\n18,West\n18,West\n,North\n'),
  })
  await page.getByRole('button', { name: 'Upload dataset' }).click()
  await expect(page.getByText('ready', { exact: true })).toBeVisible({ timeout: 30_000 })
  await expect(page.getByText('4 rows × 2 columns')).toBeVisible()
  await expect(page.getByText('browser-sales.csv')).toBeVisible()

  await page.getByRole('tab', { name: 'Column profile' }).click()
  await expect(page.getByRole('table', { name: 'Read-only column profile' })).toContainText('amount')
  await expect(page.getByRole('table', { name: 'Read-only column profile' })).toContainText('18')

  await page.getByRole('tab', { name: 'Data preview' }).click()
  await expect(page.getByRole('table', { name: 'Uploaded dataset preview' })).toContainText('North')
})
