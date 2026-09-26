import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { createServer, type Server } from 'node:http'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { _electron as electron, expect, test } from '@playwright/test'
import type { SimDesktopApi } from '@sim/desktop-bridge'
import { build } from 'esbuild'
import postcss from 'postcss'
import loadPostcssConfig from 'postcss-load-config'

const DESKTOP_DIR = fileURLToPath(new URL('..', import.meta.url))
const SIM_DIR = fileURLToPath(new URL('../../sim/', import.meta.url))
const FIXTURE = fileURLToPath(new URL('./fixtures/browser-chrome.tsx', import.meta.url))
const SCOPE = 'browser-chrome-fixture'

test('crowded tabs and renderer overlays work with a real native browser page', async () => {
  const testInfo = test.info()
  let server: Server | undefined
  let userData: string | undefined
  let app: Awaited<ReturnType<typeof electron.launch>> | undefined
  try {
    const config = await loadPostcssConfig({}, SIM_DIR)
    const stylesheet = join(SIM_DIR, 'app/_styles/globals.css')
    const css = await postcss(config.plugins).process(
      `${readFileSync(stylesheet, 'utf8')}\n@source ${JSON.stringify(FIXTURE)};`,
      { from: stylesheet }
    )
    const hook = join(
      SIM_DIR,
      'app/workspace/[workspaceId]/home/components/mothership-view/components/resource-content/components/browser-session/browser-panel-occlusion.ts'
    )
    const bundle = await build({
      stdin: {
        contents: `import { mountBrowserChromeFixture } from ${JSON.stringify(FIXTURE)};
import { useBrowserPanelOcclusion } from ${JSON.stringify(hook)};
mountBrowserChromeFixture(useBrowserPanelOcclusion);`,
        resolveDir: SIM_DIR,
        loader: 'tsx',
      },
      bundle: true,
      write: false,
      outfile: testInfo.outputPath('fixture.js'),
      external: ['node:async_hooks'],
      banner: { js: 'var process={env:{NODE_ENV:"development"},browser:true};' },
      format: 'iife',
      platform: 'browser',
      tsconfig: join(SIM_DIR, 'tsconfig.json'),
      define: { 'process.env.NODE_ENV': '"development"' },
    })
    server = createServer((request, response) => {
      const path = new URL(request.url ?? '/', 'http://localhost').pathname
      if (path === '/fixture.js' || path === '/fixture.css') {
        response.setHeader('Content-Type', path.endsWith('.js') ? 'text/javascript' : 'text/css')
        response.end(
          path.endsWith('.js')
            ? bundle.outputFiles.find((file) => file.path.endsWith('.js'))?.text
            : `${css.css}\n${bundle.outputFiles.find((file) => file.path.endsWith('.css'))?.text ?? ''}`
        )
        return
      }
      if (path.startsWith('/api/')) {
        response.setHeader('Content-Type', 'application/json')
        response.end(
          path === '/api/auth/get-session'
            ? JSON.stringify({ user: { id: 'fixture-user' }, session: { id: 'fixture-session' } })
            : '{}'
        )
        return
      }
      response.writeHead(200, {
        'Content-Type': 'text/html',
        'Set-Cookie': 'better-auth.session_token=fixture; HttpOnly; SameSite=Lax; Path=/',
      })
      response.end(
        path === '/page'
          ? '<!doctype html><html><body style="background:#192b40;color:white;font:24px system-ui;padding:25px"><h1>Browser fixture</h1><p>A live page behind the application chrome.</p><button>Page action</button></body></html>'
          : '<!doctype html><html class="dark"><head><link rel="stylesheet" href="/fixture.css"></head><body style="margin:0;background:var(--bg);color:var(--text-primary)"><div id="root"></div><script src="/fixture.js"></script></body></html>'
      )
    })
    await new Promise<void>((resolve) => server?.listen(0, resolve))
    const address = server.address()
    if (!address || typeof address === 'string') throw new Error('Missing fixture address')
    userData = mkdtempSync(join(tmpdir(), 'sim-browser-chrome-e2e-'))
    app = await electron.launch({
      args: [process.env.SIM_DESKTOP_E2E_MAIN ?? '.'],
      cwd: DESKTOP_DIR,
      env: {
        ...process.env,
        SIM_DESKTOP_ORIGIN: `http://127.0.0.1:${address.port}`,
        SIM_DESKTOP_USER_DATA: userData,
      },
    })
    const shell = app
    const page = await shell.firstWindow()
    await shell.evaluate(({ app, BrowserWindow }) => {
      const window = BrowserWindow.getAllWindows()[0]
      window.setContentSize(1100, 750)
      window.webContents.setBackgroundThrottling(false)
      app.focus({ steal: true })
      window.focus()
    })
    const nativeVisible = () =>
      shell.evaluate(({ BrowserWindow, WebContentsView }) =>
        BrowserWindow.getAllWindows()[0]
          .contentView.children.find(
            (view) => view instanceof WebContentsView && view.webContents.getURL().endsWith('/page')
          )
          ?.getVisible()
      )
    await expect(page.locator('[data-tab-strip-item]')).toHaveCount(8)
    await test.step('Eight tabs shrink to available width without early overflow', async () => {
      const geometry = await page.locator('[data-tab-strip-item]').evaluateAll((tabs) =>
        tabs.map((tab) => {
          const bounds = tab.getBoundingClientRect()
          return { width: bounds.width, right: bounds.right }
        })
      )
      expect(geometry.every((tab) => tab.width < 160)).toBe(true)
      expect(geometry.at(-1)?.right).toBeLessThan(1070)
      await page.screenshot({ path: testInfo.outputPath('tabs.png') })
    })
    await test.step('Crowded tabs keep readable labels when selected, hovered, and focused', async () => {
      await page.locator('#many-tabs').click()
      await expect(page.locator('[data-tab-strip-item]')).toHaveCount(18)
      const overflow = await page
        .locator('[data-tab-strip-item]')
        .first()
        .evaluate((tab) => ({
          scrollWidth: tab.parentElement?.scrollWidth ?? 0,
          clientWidth: tab.parentElement?.clientWidth ?? 0,
        }))
      expect(overflow.scrollWidth).toBeGreaterThan(overflow.clientWidth)
      const active = page.getByRole('tab', { selected: true })
      const label = active.locator('[data-overflow-text]')
      await expect
        .poll(() => label.evaluate((element) => element.getBoundingClientRect().width))
        .toBeGreaterThanOrEqual(48)
      const neighbor = page.getByRole('tab').nth(2)
      const beforeHover = await neighbor.evaluate((element: HTMLElement) => ({
        left: element.offsetLeft,
        width: element.offsetWidth,
      }))
      await neighbor.hover()
      await expect
        .poll(() =>
          neighbor
            .locator('[data-overflow-text]')
            .evaluate((element) => element.getBoundingClientRect().width)
        )
        .toBeGreaterThanOrEqual(48)
      expect(
        await neighbor.evaluate((element: HTMLElement) => ({
          left: element.offsetLeft,
          width: element.offsetWidth,
        }))
      ).toEqual(beforeHover)
      await neighbor.click()
      await expect(neighbor).toHaveAttribute('aria-selected', 'true')
      await page.keyboard.press('End')
      const last = page.getByRole('tab').last()
      await expect(last).toBeFocused()
      await expect(last).toHaveAttribute('aria-selected', 'true')
      await expect(last).toBeInViewport({ ratio: 1 })
      await expect
        .poll(() => label.evaluate((element) => element.getBoundingClientRect().width))
        .toBeGreaterThanOrEqual(48)
      await page.mouse.move(200, 180)
      await page.screenshot({
        path: testInfo.outputPath('crowded-tabs.png'),
        animations: 'disabled',
      })
      await page.evaluate(() => document.documentElement.classList.remove('dark'))
      await page.screenshot({
        path: testInfo.outputPath('crowded-tabs-light.png'),
        animations: 'disabled',
      })
      await page.evaluate(() => document.documentElement.classList.add('dark'))
      await page.keyboard.press('Home')
      await expect(page.getByRole('tab').first()).toBeInViewport({ ratio: 1 })
      await page.locator('#eight-tabs').click()
    })
    await test.step('Touch tabs leave room for both attention and close controls', async () => {
      const session = await page.context().newCDPSession(page)
      try {
        await session.send('Emulation.setTouchEmulationEnabled', { enabled: true })
        expect(await page.evaluate(() => matchMedia('(any-pointer: coarse)').matches)).toBe(true)
        await page.locator('#many-tabs').click()
        const attention = page.getByRole('tab').nth(1)
        await expect
          .poll(() =>
            attention
              .locator('[data-overflow-text]')
              .evaluate((element) => element.getBoundingClientRect().width)
          )
          .toBeGreaterThanOrEqual(48)
        const attentionItem = page.locator('[data-tab-strip-item="tab-1"]')
        const indicator = attentionItem.locator('[data-row-action-indicator]')
        const controls = attentionItem.locator('[data-row-action-controls]')
        await expect(indicator).toBeVisible()
        await expect(indicator).toHaveCSS('opacity', '1')
        await expect(controls).toHaveCSS('opacity', '1')
        await attentionItem.getByRole('button', { name: /^Close / }).click({ trial: true })
        expect(
          await attentionItem.evaluate((element) => {
            const title = element.querySelector('[data-overflow-text]')?.getBoundingClientRect()
            const indicator = element
              .querySelector('[data-row-action-indicator]')
              ?.getBoundingClientRect()
            const close = element.querySelector('[aria-label^="Close "]')?.getBoundingClientRect()
            return (
              title &&
              indicator &&
              close &&
              title.right <= indicator.left &&
              indicator.right <= close.left &&
              close.right <= element.getBoundingClientRect().right
            )
          })
        ).toBe(true)
        await page.screenshot({ path: testInfo.outputPath('crowded-tabs-touch.png') })
        const beforeSelection = await attention.evaluate(
          (element: HTMLElement) => element.offsetWidth
        )
        await attention.click()
        await expect(attention).toHaveAttribute('aria-selected', 'true')
        expect(await attention.evaluate((element: HTMLElement) => element.offsetWidth)).toBe(
          beforeSelection
        )
        await page.locator('#toggle-activity').click()
        expect(await attention.evaluate((element: HTMLElement) => element.offsetWidth)).toBe(
          beforeSelection
        )
        await page.locator('#toggle-activity').click()
        await page.locator('#medium-tabs').click()
        await page.getByRole('tab').first().click()
        const intrinsicWidth = await attention.evaluate(
          (element: HTMLElement) => element.offsetWidth
        )
        expect(intrinsicWidth).toBeGreaterThan(144)
        expect(intrinsicWidth).toBeLessThan(200)
        await attention.click()
        expect(await attention.evaluate((element: HTMLElement) => element.offsetWidth)).toBe(
          intrinsicWidth
        )
        await page.locator('#toggle-activity').click()
        expect(await attention.evaluate((element: HTMLElement) => element.offsetWidth)).toBe(
          intrinsicWidth
        )
        await page.locator('#toggle-activity').click()
      } finally {
        await session.send('Emulation.setTouchEmulationEnabled', { enabled: false })
        await session.detach()
      }
      await page.locator('#eight-tabs').click()
    })
    await test.step('Short labels stay below the maximum tab width', async () => {
      await page.locator('#short-tabs').click()
      const widths = await page
        .locator('[data-tab-strip-item]')
        .evaluateAll((tabs) => tabs.map((tab) => tab.getBoundingClientRect().width))
      expect(widths.every((width) => width < 120)).toBe(true)
      await page.locator('#eight-tabs').click()
    })
    await test.step('An open menu recovers when no native page was available for its initial capture', async () => {
      await page.locator('#menu-trigger').click()
      await expect(page.getByRole('menu')).toBeVisible()
      expect(
        await page.evaluate(
          (scope) =>
            (
              globalThis as typeof globalThis & { simDesktop: SimDesktopApi }
            ).simDesktop.browserAgent.capturePanelSnapshot(scope),
          SCOPE
        )
      ).toBeNull()
      await expect(page.locator('#snapshot')).toHaveCount(0)
      await page
        .locator('#start-native')
        .evaluate((button) => (button as HTMLButtonElement).click())
      await expect.poll(nativeVisible).toBe(false)
      await expect(page.locator('#snapshot')).toBeVisible()
      await expect(page.getByRole('menu')).toBeVisible()
      await page.keyboard.press('Escape')
      await expect.poll(nativeVisible).toBe(true)
    })
    await test.step('Tooltip appears above the real native browser', async () => {
      await page.locator('#reference').hover()
      await expect(page.getByRole('tooltip')).toBeVisible()
      await expect.poll(nativeVisible).toBe(false)
      await expect(page.locator('#snapshot')).toBeVisible()
      await page.screenshot({ path: testInfo.outputPath('tooltip.png') })
    })
    await test.step('Leaving the tooltip restores the native browser', async () => {
      await page.mouse.move(200, 180)
      await expect.poll(nativeVisible).toBe(true)
      await expect(page.locator('#snapshot')).toHaveCount(0)
    })
    await test.step('An open menu remains above the page when its item tooltip disappears', async () => {
      await page.locator('#menu-trigger').click()
      await expect(page.getByRole('menu')).toBeVisible()
      await expect.poll(nativeVisible).toBe(false)
      await page.locator('#tooltip-item').hover()
      await expect(page.getByRole('tooltip')).toBeVisible()
      await page.locator('#plain-item').hover()
      await expect(page.getByRole('tooltip')).toHaveCount(0)
      await expect(page.getByRole('menu')).toBeVisible()
      await expect.poll(nativeVisible).toBe(false)
      await expect(page.locator('#snapshot')).toBeVisible()
    })
    await test.step('Resizing with an open menu refreshes the captured viewport', async () => {
      await shell.evaluate(({ BrowserWindow }) =>
        BrowserWindow.getAllWindows()[0].setContentSize(1000, 750)
      )
      await expect
        .poll(() =>
          page.locator('#snapshot').evaluate((image) => image.getBoundingClientRect().width)
        )
        .toBe(450)
      await expect.poll(nativeVisible).toBe(false)
      await page.screenshot({ path: testInfo.outputPath('menu.png') })
    })
    await test.step('Escape dismisses the menu and restores the native browser', async () => {
      await page.keyboard.press('Escape')
      await expect(page.getByRole('menu')).toHaveCount(0)
      await expect.poll(nativeVisible).toBe(true)
      await expect(page.locator('#snapshot')).toHaveCount(0)
    })
  } catch (error) {
    const page = app?.windows()[0]
    if (page && !page.isClosed()) {
      await page.screenshot({ path: testInfo.outputPath('failure.png') })
      const overlays = await page.locator('[data-native-surface-overlay]').evaluateAll((elements) =>
        elements.map((element) => ({
          text: element.textContent,
          bounds: element.getBoundingClientRect().toJSON(),
          opacity: getComputedStyle(element).opacity,
          visibility: getComputedStyle(element).visibility,
        }))
      )
      await testInfo.attach('overlay-state', {
        body: JSON.stringify(overlays, null, 2),
        contentType: 'application/json',
      })
    }
    throw error
  } finally {
    await app?.close()
    if (server?.listening) {
      const listener = server
      await new Promise<void>((resolve, reject) =>
        listener.close((error) => (error ? reject(error) : resolve()))
      )
    }
    if (userData) rmSync(userData, { recursive: true, force: true })
  }
})
