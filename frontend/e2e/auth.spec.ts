import { expect, test } from '@playwright/test'
import AxeBuilder from '@axe-core/playwright'
import { randomUUID } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { password, registerAccount } from './account'

test('real registration, account, refresh, logout, re-login and authorization', async ({
  page,
}, testInfo) => {
  const email = `phase3-e2e-${randomUUID()}@example.com`
  await page.goto('/')
  await expect(
    page.getByRole('link', { name: /Explore Platform/ }),
  ).toHaveCount(0)
  await page
    .getByRole('main')
    .getByRole('link', { name: 'Get Started', exact: true })
    .first()
    .click()
  await page.getByLabel('Display name').fill('Browser Account')
  await page.getByLabel('Email address').fill(email)
  await page.getByLabel('Password', { exact: true }).fill(password)
  await page.getByLabel('Confirm password').fill(password)
  expect(
    (
      await new AxeBuilder({ page })
        .withTags(['wcag2a', 'wcag2aa', 'wcag21aa'])
        .analyze()
    ).violations,
  ).toEqual([])
  await page.getByRole('button', { name: 'Create account' }).click()
  await expect(page).toHaveURL('/dashboard')
  await expect(page.locator('.preview-banner strong')).toHaveText('Browser Account')
  await expect(page.locator('.stat-card strong')).toHaveText([
    '0',
    '0',
    '0',
    '0',
  ])
  await page.screenshot({
    path: testInfo.outputPath('account-dashboard.png'),
    fullPage: true,
  })
  await page.reload()
  await expect(page.locator('.stat-card strong')).toHaveText([
    '0',
    '0',
    '0',
    '0',
  ])
  const session = (await page.context().cookies()).find(
    (cookie) => cookie.name === 'autoinsight_session',
  )!
  expect(session.httpOnly).toBe(true)
  expect(session.sameSite).toBe('Lax')
  expect(session.path).toBe('/api/v1')
  expect(
    await page.evaluate(() => localStorage.length + sessionStorage.length),
  ).toBe(0)
  expect(await page.evaluate(() => document.cookie)).not.toContain(
    session.value,
  )
  await page.getByRole('button', { name: 'Open account information' }).click()
  await expect(page.getByRole('dialog').getByText(email)).toBeVisible()
  await page.getByRole('button', { name: 'Sign out', exact: true }).click()
  await expect(page).toHaveURL('/login')
  expect((await page.request.get('/api/v1/dashboard/overview')).status()).toBe(
    401,
  )
  expect(
    (
      await page.request.get('/api/v1/auth/me', {
        headers: { Cookie: `autoinsight_session=${session.value}` },
      })
    ).status(),
  ).toBe(401)
  await page.goto('/datasets')
  await expect(page).toHaveURL('/login')
  await page.getByLabel('Email address').fill(email)
  await page.getByLabel('Password', { exact: true }).fill('wrong password')
  await page.getByRole('button', { name: 'Sign in', exact: true }).click()
  await expect(page.getByRole('alert')).toContainText(
    'Email or password is incorrect.',
  )
  await page.getByLabel('Password', { exact: true }).fill(password)
  await page.getByRole('button', { name: 'Sign in', exact: true }).click()
  await expect(page).toHaveURL('/datasets')
  await expect(
    page.getByRole('heading', { name: 'Your datasets' }),
  ).toBeVisible()
})

test('two real users have isolated overview and dataset metadata', async ({
  page,
  browser,
}) => {
  const a = await registerAccount(page, 'Owner A')
  // Insert only uniquely identified synthetic metadata; no Phase 4 upload endpoint is introduced.
  const python = fileURLToPath(
    new URL('../../backend/.venv/Scripts/python.exe', import.meta.url),
  )
  const backend = fileURLToPath(new URL('../../backend', import.meta.url))
  const datasetId = execFileSync(
    python,
    [
      '-c',
      `import sys; from uuid import UUID; from sqlalchemy.orm import Session; from app.core.config import Settings; from app.db.session import create_db_engine; from app.db.models import User, Dataset; e=create_db_engine(Settings()); s=Session(e); u=s.get(User,UUID(sys.argv[1])); assert u.email.startswith('phase3-e2e-') and u.email.endswith('@example.com'); d=Dataset(owner_id=u.id,display_name='Isolated browser test metadata',source_format='csv'); s.add(d); s.commit(); print(d.id); s.close(); e.dispose()`,
      a.id,
    ],
    { cwd: backend, encoding: 'utf8' },
  ).trim()
  await page.goto('/dashboard')
  await expect(page.locator('.stat-card strong').first()).toHaveText('1')
  expect(
    (await page.request.get(`/api/v1/datasets/${datasetId}`)).status(),
  ).toBe(200)
  const other = await browser.newContext({ baseURL: 'http://127.0.0.1:5175' })
  try {
    const b = await other.newPage()
    await registerAccount(b, 'Owner B')
    await b.goto('/dashboard')
    await expect(b.locator('.stat-card strong')).toHaveText([
      '0',
      '0',
      '0',
      '0',
    ])
    const denied = await b.request.get(`/api/v1/datasets/${datasetId}`)
    expect(denied.status()).toBe(404)
    expect(await denied.text()).not.toContain('Isolated browser')
  } finally {
    await other.close()
  }
})

test('expired sessions and backend outages clear private UI and recover', async ({
  page,
}) => {
  await registerAccount(page)
  await page.goto('/dashboard')
  await expect(page.locator('.stat-card strong')).toHaveText([
    '0',
    '0',
    '0',
    '0',
  ])
  await page.route('**/api/v1/auth/me', (route) => route.abort())
  await page.reload()
  await expect(
    page.getByText('Your workspace is temporarily unavailable.'),
  ).toBeVisible()
  await expect(page.locator('.stat-card')).toHaveCount(0)
  await page.unroute('**/api/v1/auth/me')
  await page.getByRole('button', { name: 'Retry connection' }).click()
  await expect(page.locator('.stat-card strong')).toHaveText([
    '0',
    '0',
    '0',
    '0',
  ])
  // Revoke the actual server session out of band, as another tab would do.
  const csrf = (await (await page.request.get('/api/v1/auth/csrf')).json()).data
    .csrf_token
  expect(
    (
      await page.request.post('/api/v1/auth/logout', {
        data: {},
        headers: { Origin: 'http://127.0.0.1:5175', 'X-CSRF-Token': csrf },
      })
    ).status(),
  ).toBe(200)
  await page.evaluate(() => window.dispatchEvent(new Event('focus')))
  await expect(page).toHaveURL('/login')
  await expect(
    page.getByText('Your session expired. Please sign in again.'),
  ).toBeVisible()
  await expect(
    page.getByRole('navigation', { name: 'Main navigation', exact: true }),
  ).toHaveCount(0)
})
