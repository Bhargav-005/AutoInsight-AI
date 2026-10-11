import { expect, test, type Page } from '@playwright/test'
import AxeBuilder from '@axe-core/playwright'

const routes = [
  ['/dashboard', 'A clearer view starts here.'], ['/datasets', 'Your datasets'],
  ['/datasets/sample-retail', 'Retail operations'], ['/datasets/sample-retail/clean', 'Cleaning Studio'],
  ['/research/preview', 'Follow the reasoning.'], ['/analysis/sample-retail', 'Analytics workspace'],
  ['/models/preview', 'ML Studio'], ['/history', 'Reports & history'],
]
async function sample(page: Page, path: string) {
  await page.goto(path)
  await page.getByRole('button', { name: /Explore sample workspace/ }).click()
  await expect(page.getByRole('button', { name: /Leave sample workspace/ })).toBeVisible()
}

test('all interfaces render, stay honest, and have no browser errors', async ({ page }, testInfo) => {
  const errors: string[] = []
  page.on('pageerror', (error) => errors.push(error.message))
  page.on('console', (message) => { if (message.type() === 'error' || message.type() === 'warning') errors.push(message.text()) })
  for (const [path, heading] of routes) {
    await sample(page, path)
    await expect(page.getByRole('heading', { name: heading, exact: true })).toBeVisible()
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), path).toBe(true)
    await page.screenshot({ path: testInfo.outputPath(`${path.replaceAll('/', '-')}.png`), fullPage: true })
  }
  expect(errors).toEqual([])
})

test('navigation, account dialog and focus restoration', async ({ page }) => {
  await page.goto('/dashboard')
  if ((page.viewportSize()?.width ?? 0) < 900) {
    await page.getByRole('button', { name: 'Open navigation' }).click()
    const drawer = page.getByRole('dialog', { name: 'Navigation' })
    await expect(drawer).toBeVisible()
    await page.keyboard.press('Escape')
    await expect(page.getByRole('button', { name: 'Open navigation' })).toBeFocused()
    await page.getByRole('button', { name: 'Open navigation' }).click()
    await drawer.getByRole('link', { name: 'AI Research', exact: true }).click()
    await expect(drawer).not.toBeVisible()
  } else {
    await page.getByRole('button', { name: 'Collapse sidebar' }).click()
    await expect(page.getByRole('button', { name: 'Expand sidebar' })).toBeVisible()
    await expect(page.getByRole('navigation', { name: 'Main navigation' }).getByRole('link', { name: 'AI Research' })).toHaveAttribute('title', 'AI Research')
    await page.getByRole('navigation', { name: 'Main navigation' }).getByRole('link', { name: 'AI Research' }).click()
  }
  await expect(page.getByRole('heading', { name: 'Follow the reasoning.' })).toBeVisible()
  for (const [label, heading] of [['Dashboard', 'A clearer view starts here.'], ['Datasets', 'Your datasets'], ['Cleaning Studio', 'Cleaning Studio'], ['Analytics', 'Analytics workspace'], ['ML Studio', 'ML Studio'], ['Reports & History', 'Reports & history']]) {
    if ((page.viewportSize()?.width ?? 0) < 900) {
      await page.getByRole('button', { name: 'Open navigation' }).click()
      await page.getByRole('navigation', { name: 'Mobile navigation' }).getByRole('link', { name: label, exact: true }).click()
    } else {
      await page.getByRole('navigation', { name: 'Main navigation' }).getByRole('link', { name: label, exact: true }).click()
    }
    await expect(page.getByRole('heading', { name: heading, exact: true })).toBeVisible()
  }
  await page.getByRole('button', { name: 'Open account information' }).click()
  await expect(page.getByRole('dialog', { name: 'Your workspace account' })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Close dialog' })).toBeFocused()
  await page.keyboard.press('Tab')
  await expect(page.getByRole('link', { name: 'View sign-in interface' })).toBeFocused()
  await page.keyboard.press('Shift+Tab')
  await expect(page.getByRole('button', { name: 'Close dialog' })).toBeFocused()
  // Native modal dialogs make the rest of the document inert.
  await page.getByRole('button', { name: 'Open account information', includeHidden: true }).evaluate((button: HTMLButtonElement) => button.focus())
  expect(await page.getByRole('dialog', { name: 'Your workspace account' }).evaluate((dialog) => dialog.contains(document.activeElement))).toBe(true)
  await page.keyboard.press('Escape')
  await expect(page.getByRole('button', { name: 'Open account information' })).toBeFocused()
})

test('authentication validation never sends credentials', async ({ page }) => {
  const writes: string[] = []
  page.on('request', (request) => { if (request.method() === 'POST') writes.push(request.url()) })
  await page.goto('/register')
  await page.getByRole('button', { name: 'Create account' }).click()
  await expect(page.getByText('Enter a valid email address.')).toBeVisible()
  await page.getByLabel('Email address').fill('analyst@example.com')
  await page.getByLabel('Password', { exact: true }).fill('sample-password')
  await page.getByLabel('Confirm password').fill('mismatch')
  await page.getByRole('button', { name: 'Create account' }).click()
  await expect(page.getByText('Passwords must match.')).toBeVisible()
  await page.getByLabel('Confirm password').fill('sample-password')
  await page.getByRole('button', { name: 'Show password' }).click()
  await expect(page.getByLabel('Password', { exact: true })).toHaveAttribute('type', 'text')
  await page.getByRole('button', { name: 'Create account' }).click()
  await expect(page.getByRole('status')).toContainText('No credentials were sent')
  expect(writes).toEqual([])
  await page.getByRole('link', { name: 'Open frontend preview' }).click()
  await expect(page.getByText(/Not signed in/)).toBeVisible()
})

test('sample tables, charts, role inspector and history controls work', async ({ page }) => {
  await sample(page, '/datasets/sample-retail')
  await page.getByRole('button', { name: 'Next page' }).click()
  await expect(page.getByRole('cell', { name: 'SO-1007' })).toBeVisible()
  await page.getByRole('textbox', { name: 'Search Sample retail records' }).fill('SO-1009')
  await expect(page.getByRole('cell', { name: 'SO-1009' })).toBeVisible()
  await page.getByRole('tab', { name: 'Column profile' }).focus()
  await page.keyboard.press('Enter')
  await expect(page.getByRole('table')).toContainText('Two missing labels')
  await page.keyboard.press('ArrowRight')
  await expect(page.getByRole('tab', { name: 'Versions & source' })).toHaveAttribute('aria-selected', 'true')
  await sample(page, '/analysis/sample-retail')
  await expect(page.getByText('$45,000', { exact: true })).toBeVisible()
  await page.locator('.recharts-bar-rectangle').first().hover()
  await expect(page.locator('.recharts-tooltip-wrapper').first()).toBeVisible()
  await page.getByRole('combobox', { name: 'Region', exact: true }).selectOption('North')
  await expect(page.getByText('$8,700', { exact: true })).toBeVisible()
  await page.getByLabel('Category chart view').selectOption('table')
  await expect(page.getByRole('table').first()).toContainText('Technology')
  await sample(page, '/research/preview')
  await expect(page.locator('.agent-node')).toHaveCount(7)
  await page.getByRole('button', { name: /06 RAG Knowledge/ }).click()
  await expect(page.locator('.inspector-title')).toHaveText('RAG Knowledge')
  await page.getByLabel('Research objective').fill('Understand regional revenue patterns')
  await page.getByRole('button', { name: 'View illustrative plan' }).click()
  await expect(page.getByText('Static plan template')).toBeVisible()
  await page.getByRole('button', { name: 'Preview approval' }).click()
  await expect(page.getByRole('status')).toContainText('nothing was saved')
  await sample(page, '/history')
  await page.getByRole('combobox', { name: 'Type', exact: true }).selectOption('Report')
  await page.getByRole('button', { name: 'Regional revenue brief', exact: true }).click()
  await expect(page.getByRole('dialog')).toContainText('no stored report')
  await expect(page.getByRole('button', { name: 'Download unavailable', exact: true })).toBeDisabled()
  await page.keyboard.press('Escape')
  await expect(page.getByRole('button', { name: 'Regional revenue brief', exact: true })).toBeFocused()
})

test('core routes pass automated accessibility checks', async ({ page }) => {
  test.setTimeout(60000)
  for (const path of ['/login', '/register', '/dashboard', '/datasets/sample-retail', '/research/preview', '/analysis/sample-retail', '/models/preview', '/history']) {
    if (path === '/login' || path === '/register') await page.goto(path)
    else await sample(page, path)
    const results = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa']).analyze()
    expect(results.violations.map(({ id, nodes }) => ({ id, targets: nodes.map((node) => node.target) })), path).toEqual([])
  }
})

test('key widths and reduced motion remain usable', async ({ page }, testInfo) => {
  test.setTimeout(120000)
  test.skip(testInfo.project.name === 'mobile', 'Viewport matrix runs once in desktop project')
  await page.emulateMedia({ reducedMotion: 'reduce' })
  for (const width of [320, 375, 768, 1024, 1440]) {
    await page.setViewportSize({ width, height: 900 })
    for (const [path] of routes) {
      await sample(page, path)
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `${path} at ${width}px`).toBe(true)
      if (['/dashboard', '/analysis/sample-retail', '/research/preview'].includes(path)) {
        await page.screenshot({ path: testInfo.outputPath(`${width}${path.replaceAll('/', '-')}.png`), fullPage: true })
      }
    }
    await page.goto('/login')
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
    await page.screenshot({ path: testInfo.outputPath(`${width}-login.png`), fullPage: true })
  }
  await page.goto('/research/preview')
  expect(await page.locator('.agent-node').first().evaluate((element) => getComputedStyle(element).transitionDuration)).toBe('0s')
})
