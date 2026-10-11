import { expect, test } from '@playwright/test'
import { registerAccount } from './account'

test('real ML training, held-out results and persisted prediction workflow', async ({ page }) => {
  test.setTimeout(90_000)
  const errors: string[] = []
  page.on('pageerror', (error) => errors.push(error.message))
  await registerAccount(page, 'ML browser analyst')
  await page.goto('/datasets')
  const rows = Array.from({ length: 240 }, (_, i) => {
    const signal = Math.sin(i * 2.39) * 4
    return `${i + 1},${signal.toFixed(5)},${i % 3 === 0 ? 'north' : 'south'},${signal > 0 ? 'positive' : 'negative'}`
  })
  await page.getByLabel('Choose dataset file').setInputFiles({ name: 'ml-browser.csv', mimeType: 'text/csv', buffer: Buffer.from(['record_id,signal,region,target', ...rows, ''].join('\n')) })
  await page.getByRole('button', { name: 'Upload dataset' }).click()
  await expect(page.getByText('ready', { exact: true })).toBeVisible({ timeout: 30_000 })
  const datasetId = new URL(page.url()).pathname.split('/').at(-1)!
  await page.getByRole('link', { name: 'Open ML Studio', exact: true }).click()
  await expect(page).toHaveURL(`/models/${datasetId}`)
  await expect(page.getByRole('heading', { name: 'ML Studio', exact: true })).toBeVisible()
  await page.getByLabel('Target column', { exact: true }).selectOption('column_004')
  await expect(page.getByRole('checkbox', { name: /record_id/ })).not.toBeChecked()
  await page.getByRole('checkbox', { name: /I confirm these rows/ }).check()
  await page.getByRole('button', { name: 'Start Training', exact: true }).click()
  await expect(page.getByRole('status')).toContainText('completed', { timeout: 45_000 })
  await expect(page.getByRole('table', { name: 'Held-out metrics and baseline' })).toContainText('accuracy')
  await expect(page.getByRole('table', { name: /Confusion matrix/ })).toBeVisible()
  await page.getByLabel('Prediction signal', { exact: true }).fill('2.5')
  await page.getByLabel('Prediction region', { exact: true }).fill('unseen-region')
  await page.getByRole('button', { name: 'Predict', exact: true }).click()
  await expect(page.getByText('Latest prediction:')).toContainText('positive')
  await page.reload()
  await expect(page.getByRole('table', { name: 'Saved prediction history' })).toContainText('positive')
  await expect(page.getByRole('link', { name: 'ML Studio', exact: true })).toHaveAttribute('href', `/models/${datasetId}`)
  expect(errors).toEqual([])
  await page.screenshot({ path: 'test-results/ml-studio-desktop.png', fullPage: true })
})
