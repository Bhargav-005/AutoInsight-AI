import { expect, test } from '@playwright/test'
import AxeBuilder from '@axe-core/playwright'

test('public entry renders offline, links correctly, and stays free of browser errors', async ({
  page,
}) => {
  const errors: string[] = []
  const apiRequests: string[] = []
  page.on('pageerror', (error) => errors.push(error.message))
  page.on('console', (message) => {
    if (message.type() === 'error' || message.type() === 'warning')
      errors.push(message.text())
  })
  await page.route('**/api/v1/**', (route) => {
    apiRequests.push(route.request().url())
    return route.abort()
  })
  await page.goto('/')
  await expect(page.getByRole('heading', { level: 1 })).toContainText(
    'From raw data',
  )
  await expect(
    page.getByRole('navigation', { name: 'Main navigation', exact: true }),
  ).toHaveCount(0)
  await expect(
    page.getByText(
      /Data processing, authentication and AI execution are in development/,
    ),
  ).toBeVisible()
  expect(apiRequests).toEqual([])
  await page
    .getByRole('main')
    .getByRole('link', { name: 'Get Started', exact: true })
    .first()
    .click()
  await expect(page).toHaveURL('/register')
  await expect(
    page.getByRole('heading', { name: 'Create your workspace' }),
  ).toBeVisible()
  await page.goto('/')
  await page
    .getByRole('main')
    .getByRole('link', { name: 'Sign In', exact: true })
    .click()
  await expect(page).toHaveURL('/login')
  await expect(
    page.getByRole('heading', { name: 'Welcome back.' }),
  ).toBeVisible()
  await page.goto('/')
  await page.getByRole('link', { name: /Explore Platform/ }).click()
  await expect(page).toHaveURL('/dashboard')
  await expect(page.getByText(/Not signed in/)).toBeVisible()
  expect(errors).toEqual([])
})

test('keyboard navigation, modal focus, anchors and seven role descriptions work', async ({
  page,
}) => {
  await page.goto('/')
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible()
  await page.keyboard.press('Tab')
  await expect(
    page.getByRole('link', { name: 'Skip to content' }),
  ).toBeFocused()
  await page.keyboard.press('Enter')
  await expect(page.getByRole('main')).toBeFocused()
  const mobile = (page.viewportSize()?.width ?? 0) <= 800
  const menuButton = page.getByRole('button', {
    name: 'Open public navigation',
  })
  const menu = page.getByRole('dialog', { name: 'Public navigation menu' })
  if (mobile) {
    await menuButton.click()
    await expect(
      page.getByRole('button', { name: 'Close public navigation' }),
    ).toBeFocused()
    await page.keyboard.press('Tab')
    await expect(
      menu.getByRole('link', { name: 'Features', exact: true }),
    ).toBeFocused()
    await menuButton.evaluate((button: HTMLButtonElement) => button.focus())
    expect(
      await menu.evaluate((dialog) => dialog.contains(document.activeElement)),
    ).toBe(true)
    await page.keyboard.press('Escape')
    await expect(menu).not.toBeVisible()
    await expect(menuButton).toBeFocused()
  }
  for (const [label, id] of [
    ['Features', 'features'],
    ['How It Works', 'how-it-works'],
    ['Architecture', 'architecture'],
  ]) {
    if (mobile) await menuButton.click()
    const nav = page.getByRole('navigation', {
      name: mobile ? 'Mobile public navigation' : 'Public navigation',
      exact: true,
    })
    await nav.getByRole('link', { name: label, exact: true }).focus()
    await page.keyboard.press('Enter')
    await expect(page).toHaveURL(new RegExp(`#${id}$`))
    await expect(page.locator(`#${id} h2`).first()).toBeFocused()
    await expect
      .poll(async () =>
        Math.round((await page.locator(`#${id}`).boundingBox())!.y),
      )
      .toBeLessThan(120)
    if (mobile) await expect(menu).not.toBeVisible()
  }
  const roles = page.getByRole('group', { name: 'Seven logical agent roles' })
  const buttons = roles.getByRole('button')
  const descriptions = [
    'Context before computation.',
    'A deliberate change. A visible history.',
    'Compute first. Interpret second.',
    'Better questions for better models.',
    'Give every claim a second look.',
    'Relevant knowledge, in context.',
    'An explanation you can return to.',
  ]
  for (let index = 0; index < 7; index++) {
    await buttons.nth(index).focus()
    await page.keyboard.press(index % 2 ? 'Space' : 'Enter')
    await expect(buttons.nth(index)).toHaveAttribute('aria-pressed', 'true')
    await expect(roles.getByRole('button', { pressed: true })).toHaveCount(1)
    await expect(
      page
        .locator('#agent-description')
        .getByRole('heading', { name: descriptions[index], exact: true }),
    ).toBeVisible()
  }
  if (mobile) {
    await menuButton.click()
    await page.setViewportSize({ width: 1024, height: 900 })
    await expect(menu).not.toBeVisible()
    await expect(
      page.getByRole('navigation', { name: 'Public navigation', exact: true }),
    ).toBeVisible()
  }
})

test('landing meets automated accessibility checks with reduced motion', async ({
  page,
}) => {
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await page.goto('/')
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible()
  expect(
    (
      await new AxeBuilder({ page })
        .withTags(['wcag2a', 'wcag2aa', 'wcag21aa'])
        .analyze()
    ).violations,
  ).toEqual([])
  const moving = await page.locator('.landing').evaluate(
    (root) =>
      [...root.querySelectorAll('*')].filter((element) => {
        const style = getComputedStyle(element)
        return (
          (style.animationName !== 'none' &&
            parseFloat(style.animationDuration) > 0.01) ||
          parseFloat(style.transitionDuration) > 0.01
        )
      }).length,
  )
  expect(moving).toBe(0)
  await expect(page.locator('.lp-reveal-pending')).toHaveCount(0)
  if ((page.viewportSize()?.width ?? 0) <= 800) {
    await page.getByRole('button', { name: 'Open public navigation' }).click()
    expect(
      (
        await new AxeBuilder({ page })
          .withTags(['wcag2a', 'wcag2aa', 'wcag21aa'])
          .analyze()
      ).violations,
    ).toEqual([])
  }
})

test('landing fits all required widths and captures review images', async ({
  page,
}, testInfo) => {
  test.skip(
    testInfo.project.name !== 'desktop',
    'One complete width matrix is sufficient.',
  )
  await page.emulateMedia({ reducedMotion: 'reduce' })
  for (const width of [320, 375, 768, 1024, 1440]) {
    await page.setViewportSize({ width, height: 900 })
    await page.goto('/')
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible()
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
      `No overflow at ${width}px`,
    ).toBe(true)
    await page.screenshot({
      path: testInfo.outputPath(`landing-${width}-hero.png`),
    })
    await page.screenshot({
      path: testInfo.outputPath(`landing-${width}-full.png`),
      fullPage: true,
    })
    for (const id of ['features', 'how-it-works', 'architecture']) {
      await page.locator(`#${id}`).scrollIntoViewIfNeeded()
      await page.screenshot({
        path: testInfo.outputPath(`landing-${width}-${id}.png`),
      })
    }
  }
})
