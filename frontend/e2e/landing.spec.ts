import { expect, test } from '@playwright/test'
import AxeBuilder from '@axe-core/playwright'

test('public entry renders offline, links correctly, and stays free of browser errors', async ({
  page,
}) => {
  const errors: string[] = []
  const apiRequests: string[] = []
  page.on('pageerror', (error) => errors.push(error.message))
  page.on('console', (message) => {
    if (
      (message.type() === 'error' || message.type() === 'warning') &&
      !message.text().includes('401')
    )
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
  await expect(page.getByRole('heading', { name: /Your workflow/ })).toBeAttached()
  await expect(page.getByRole('heading', { name: /Depth at every step/ })).toBeAttached()
  await expect(page.getByRole('heading', { name: /A process you can follow/ })).toBeAttached()
  await expect(page.getByRole('heading', { name: /Seven roles/ })).toBeAttached()
  await expect(page.getByRole('heading', { name: /Built close to your data/ })).toBeAttached()
  await expect(page.getByRole('heading', { name: /A clearer view/ })).toBeAttached()
  await expect(page.getByRole('contentinfo')).toBeAttached()
  await expect(page.getByText('An interactive product walkthrough')).toBeVisible()
  expect(apiRequests).toEqual([])
  await page.unroute('**/api/v1/**')
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
  if ((page.viewportSize()?.width ?? 0) <= 900) {
    await page.getByRole('button', { name: 'Open public navigation' }).click()
    await page.getByRole('navigation', { name: 'Mobile public navigation' })
      .getByRole('link', { name: 'Sign In', exact: true }).click()
  } else {
    await page.getByRole('banner').getByRole('link', { name: 'Sign In', exact: true }).click()
  }
  await expect(page).toHaveURL('/login')
  await expect(
    page.getByRole('heading', { name: 'Welcome back.' }),
  ).toBeVisible()
  await page.goto('/')
  await expect(
    page.getByRole('link', { name: /Explore Platform/ }),
  ).toHaveCount(0)
  expect(errors.filter(message => !message.includes('GPU stall due to ReadPixels'))).toEqual([])
})

test('desktop hero builds extruded lettering and reverses its camera movement', async ({ page }, testInfo) => {
  test.skip((page.viewportSize()?.width ?? 0) < 768, 'The mobile hero uses its static fallback.')
  await page.emulateMedia({ reducedMotion: 'no-preference' })
  await page.goto('/')
  const scene = page.locator('.lp-webgl')
  await expect(scene).toHaveAttribute('data-state', 'ready', { timeout: 10000 })
  await expect(scene).toHaveAttribute('data-geometry', 'extruded:0.48')
  await expect(scene.locator('canvas')).toHaveCount(1)
  await page.screenshot({ path: testInfo.outputPath('hero-webgl.png') })
  const heroHeight = await page.locator('.lp-hero').evaluate(element => element.clientHeight)
  await page.evaluate(height => window.scrollTo({ top: height * 0.42, behavior: 'instant' }), heroHeight)
  await expect.poll(async () => Number(await scene.getAttribute('data-progress')), { timeout: 15000 }).toBeGreaterThan(0.3)
  const forwardProgress = Number(await scene.getAttribute('data-progress'))
  await page.evaluate(() => window.scrollTo({ top: 0, behavior: 'instant' }))
  await expect.poll(async () => Number(await scene.getAttribute('data-progress')), { timeout: 15000 }).toBeLessThan(forwardProgress - 0.15)
})

test('pinned process story transforms through seven stages and reverses on scroll up', async ({ page }, testInfo) => {
  test.skip((page.viewportSize()?.width ?? 0) < 768, 'The compact layout shows the complete static sequence.')
  await page.emulateMedia({ reducedMotion: 'no-preference' })
  await page.goto('/')
  const track = page.locator('.lp-process-track')
  const scene = page.locator('.lp-process-scene')
  await expect(scene).toHaveAttribute('data-state', 'ready', { timeout: 10000 })
  await expect(scene.locator('canvas')).toHaveCount(1)
  const start = await track.evaluate(element => element.getBoundingClientRect().top + window.scrollY)
  const range = await track.evaluate(element => element.getBoundingClientRect().height - window.innerHeight)
  await page.evaluate(top => window.scrollTo({ top, behavior: 'instant' }), start)
  await expect(track).toHaveAttribute('data-active', '0')
  await expect(track.getByRole('heading', { name: 'Ingest' })).toBeVisible()
  await page.screenshot({ path: testInfo.outputPath('process-ingest.png') })
  await page.evaluate(({ top, distance }) => window.scrollTo({ top: top + distance / 12, behavior: 'instant' }), { top: start, distance: range })
  await expect(scene).toHaveAttribute('data-segment', '0')
  await expect.poll(async () => Number(await scene.getAttribute('data-mix'))).toBeGreaterThan(.4)
  await expect.poll(async () => Number(await scene.getAttribute('data-mix'))).toBeLessThan(.6)
  await page.screenshot({ path: testInfo.outputPath('process-ingest-prepare-midpoint.png') })
  await page.evaluate(({ top, distance }) => window.scrollTo({ top: top + distance * .17, behavior: 'instant' }), { top: start, distance: range })
  await expect(track).toHaveAttribute('data-active', '1')
  await expect(scene).toHaveAttribute('data-segment', '1')
  await page.screenshot({ path: testInfo.outputPath('process-prepare.png') })
  for (const segment of [1, 2, 3, 4, 5]) {
    await page.evaluate(({ top, distance, segment }) => window.scrollTo({ top: top + distance * ((segment + .5) / 6), behavior: 'instant' }), { top: start, distance: range, segment })
    await expect(scene).toHaveAttribute('data-segment', String(segment))
    await expect.poll(async () => Number(await scene.getAttribute('data-mix'))).toBeGreaterThan(.4)
    await expect.poll(async () => Number(await scene.getAttribute('data-mix'))).toBeLessThan(.6)
    await page.waitForTimeout(250)
    await page.screenshot({ path: testInfo.outputPath(`process-transition-${segment + 1}.png`) })
  }
  for (const stage of [2, 3, 4, 5]) {
    await page.evaluate(({ top, distance, stage }) => window.scrollTo({ top: top + distance * (stage / 6 + .012), behavior: 'instant' }), { top: start, distance: range, stage })
    await expect(track).toHaveAttribute('data-active', String(stage))
    await expect(track.getByRole('heading', { name: ['Ingest', 'Prepare', 'Analyze', 'Model', 'Validate', 'Synthesize', 'Report'][stage] })).toBeVisible()
    await expect(track.getByRole('button', { name: `Go to step ${stage + 1}: ${['Ingest', 'Prepare', 'Analyze', 'Model', 'Validate', 'Synthesize', 'Report'][stage]}` })).toHaveAttribute('aria-current', 'step')
    // Let the active-step highlight and camera settle before capturing the review image.
    await page.waitForTimeout(250)
    await page.screenshot({ path: testInfo.outputPath(`process-stage-${stage + 1}.png`) })
  }
  await page.evaluate(({ top, distance }) => window.scrollTo({ top: top + distance * 0.99, behavior: 'instant' }), { top: start, distance: range })
  await expect(track).toHaveAttribute('data-active', '6')
  await expect(track.getByRole('heading', { name: 'Report' })).toBeVisible()
  await expect(track.getByRole('button', { name: 'Go to step 7: Report' })).toHaveAttribute('aria-current', 'step')
  await page.waitForTimeout(250)
  await page.screenshot({ path: testInfo.outputPath('process-report.png') })
  await page.evaluate(({ top, distance }) => window.scrollTo({ top: top + distance * 0.18, behavior: 'instant' }), { top: start, distance: range })
  await expect(track).toHaveAttribute('data-active', '1')
  await track.getByRole('button', { name: 'Go to step 5: Validate' }).click()
  await expect(track).toHaveAttribute('data-active', '4')
  await page.setViewportSize({ width: 768, height: 900 })
  await expect(track.locator('.lp-process-stage')).toBeVisible()
  await expect(scene.locator('canvas')).toHaveCount(1)
  await page.waitForTimeout(250)
  await page.screenshot({ path: testInfo.outputPath('process-tablet.png') })
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(768)

  const renderCadence = await page.evaluate(async ({ top, distance }) => {
    const scene = document.querySelector<HTMLElement>('.lp-process-scene')!
    const intervals: number[] = []
    const frameIntervals: number[] = []
    let last = 0
    let lastFrame = 0
    let frameCount = 0
    let scrollEventCount = 0
    let longTasks = 0
    const observer = new MutationObserver(() => {
      const now = performance.now()
      if (last) intervals.push(now - last)
      last = now
    })
    observer.observe(scene, { attributes: true, attributeFilter: ['data-progress'] })
    const taskObserver = new PerformanceObserver(list => { longTasks += list.getEntries().length })
    taskObserver.observe({ type: 'longtask', buffered: false })
    const countScroll = () => { scrollEventCount++ }
    window.addEventListener('scroll', countScroll, { passive: true })
    await new Promise<void>(resolve => {
      const started = performance.now()
      const sample = (now: number) => {
        frameCount++
        if (lastFrame) frameIntervals.push(now - lastFrame)
        lastFrame = now
        if (now - started < 1000) requestAnimationFrame(sample)
        else resolve()
      }
      requestAnimationFrame(sample)
      window.scrollTo({ top: top + distance * .82, behavior: 'smooth' })
    })
    observer.disconnect()
    taskObserver.disconnect()
    window.removeEventListener('scroll', countScroll)
    intervals.sort((a, b) => a - b)
    frameIntervals.sort((a, b) => a - b)
    return {
      animationFrames: frameCount,
      p95AnimationFrameMs: frameIntervals[Math.floor(frameIntervals.length * .95)] ?? null,
      scrollEvents: scrollEventCount,
      renderedUpdates: intervals.length + (last ? 1 : 0),
      p95UpdateIntervalMs: intervals[Math.floor(intervals.length * .95)] ?? null,
      longTasks,
    }
  }, { top: start, distance: range })
  console.log(`PROCESS_RENDER_CADENCE ${JSON.stringify(renderCadence)}`)
  const trackHeight = await track.evaluate(element => (element as HTMLElement).offsetHeight)
  await page.evaluate(({ top, height }) => window.scrollTo({ top: top + height + 120, behavior: 'instant' }), { top: start, height: trackHeight })
  await expect(page.locator('#architecture h2')).toBeVisible()
  await expect(track.getByRole('heading', { name: 'Validate' })).not.toBeInViewport()
})

test('process story shows its WebGL fallback when a renderer cannot be created', async ({ page }) => {
  test.skip((page.viewportSize()?.width ?? 0) < 768, 'The mobile layout always uses static stages.')
  await page.addInitScript(() => {
    const original = HTMLCanvasElement.prototype.getContext
    HTMLCanvasElement.prototype.getContext = function (this: HTMLCanvasElement, type, ...args) {
      if (typeof type === 'string' && type.startsWith('webgl')) return null
      return original.call(this, type, ...args)
    } as typeof HTMLCanvasElement.prototype.getContext
  })
  await page.emulateMedia({ reducedMotion: 'no-preference' })
  await page.goto('/')
  const scene = page.locator('.lp-process-scene')
  await expect(scene).toHaveAttribute('data-state', 'fallback')
  await expect(scene.locator('.lp-process-fallback')).toBeVisible()
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
  const roles = page.getByRole('tablist', { name: 'Seven logical agent roles' })
  const buttons = roles.getByRole('tab')
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
    await expect(buttons.nth(index)).toHaveAttribute('aria-selected', 'true')
    await expect(roles.getByRole('tab', { selected: true })).toHaveCount(1)
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
}, testInfo) => {
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await page.goto('/')
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible()
  await expect(page.locator('.lp-process-static li')).toHaveCount(7)
  await expect(page.locator('.lp-process-stage')).toBeHidden()
  if ((page.viewportSize()?.width ?? 0) <= 600) {
    await page.locator('.lp-process-static').scrollIntoViewIfNeeded()
    await page.screenshot({ path: testInfo.outputPath('process-mobile-reduced-motion.png') })
  }
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
  await expect(page.locator('.will-reveal')).toHaveCount(0)
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
  test.setTimeout(90000)
  test.skip(
    testInfo.project.name !== 'desktop',
    'One complete width matrix is sufficient.',
  )
  await page.emulateMedia({ reducedMotion: 'reduce' })
  for (const width of [320, 375, 768, 1024, 1440, 1920]) {
    await page.setViewportSize({ width, height: 900 })
    await page.goto('/')
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible()
    const widthCheck = await page.evaluate(() => ({
      viewport: innerWidth,
      document: document.documentElement.scrollWidth,
      offenders: [...document.querySelectorAll<HTMLElement>('body *')]
        .map(element => ({name: element.className?.toString() || element.tagName, left: Math.round(element.getBoundingClientRect().left), right: Math.round(element.getBoundingClientRect().right)}))
        .filter(element => element.left < -1 || element.right > innerWidth + 1)
        .slice(0, 12),
    }))
    expect(widthCheck.document <= widthCheck.viewport, `No overflow at ${width}px: ${JSON.stringify(widthCheck)}`).toBe(true)
    await page.screenshot({
      path: testInfo.outputPath(`landing-${width}-hero.png`),
    })
    await page.screenshot({
      path: testInfo.outputPath(`landing-${width}-full.png`),
      fullPage: true,
    })
    for (const id of ['workflow', 'features', 'how-it-works', 'architecture', 'security']) {
      await page.locator(`#${id}`).scrollIntoViewIfNeeded()
      await page.screenshot({
        path: testInfo.outputPath(`landing-${width}-${id}.png`),
      })
    }
  }
})
