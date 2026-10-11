import { expect, type Page } from '@playwright/test'
import { randomUUID } from 'node:crypto'

export const password = 'Browser test passphrase 2026!'
export async function registerAccount(page: Page, label = 'Browser Analyst') {
  const email = `phase3-e2e-${randomUUID()}@example.com`
  const csrf = await page.request.get('/api/v1/auth/csrf')
  const response = await page.request.post('/api/v1/auth/register', {
    data: { email, password, display_name: label },
    headers: {
      Origin: 'http://127.0.0.1:5175',
      'X-CSRF-Token': (await csrf.json()).data.csrf_token,
    },
  })
  expect(response.status(), await response.text()).toBe(201)
  return { email, id: (await response.json()).data.id }
}
