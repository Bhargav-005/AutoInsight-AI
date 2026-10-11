import { expect, test } from '@playwright/test'

test('real API status, keyboard access, responsive layout and disconnection', async ({ page }, testInfo) => {
  const ready = true
  const expected = `API connected · Platform ${ready ? 'ready' : 'not ready'}`
  await page.goto('/status')
  await expect(page.getByRole('heading', { name: 'AutoInsight AI' })).toBeVisible()
  await expect(page.getByRole('status')).toHaveText(expected)
  await expect(page.getByText(ready ? 'Available' : 'Not configured', { exact: true })).toHaveCount(3)
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
  await page.getByRole('button', { name: /Check again/ }).focus()
  await expect(page.getByRole('button', { name: /Check again/ })).toBeFocused()
  await page.screenshot({ path: testInfo.outputPath('connected.png'), fullPage: true })
  await page.route('**/api/v1/health/ready', (route) => route.abort('connectionrefused'))
  await page.getByRole('button', { name: /Check again/ }).click()
  await expect(page.getByRole('status')).toHaveText('API unavailable')
  await page.unroute('**/api/v1/health/ready')
  await page.getByRole('button', { name: /Check again/ }).click()
  await expect(page.getByRole('status')).toHaveText(expected)
})
