import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { createServer } from 'node:http'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { _electron as electron, expect, test } from '@playwright/test'
import type { SimDesktopApi } from '@sim/desktop-bridge'
import { getErrorMessage } from '@sim/utils/errors'
import { build } from 'esbuild'
import postcss from 'postcss'
import loadPostcssConfig from 'postcss-load-config'

const DESKTOP_DIR = fileURLToPath(new URL('..', import.meta.url))
const SIM_DIR = fileURLToPath(new URL('../../sim/', import.meta.url))
const FIXTURE = fileURLToPath(new URL('../../sim/scripts/fixtures/chat-panel.tsx', import.meta.url))

test('chat panel sizes survive navigation, chat switches, collapse, and layout constraints', async () => {
  const reportPath = process.env.CHAT_PANEL_REPORT_PATH ?? test.info().outputPath('chat-panel.json')
  const checks: {
    name: string
    status: 'passed' | 'failed'
    durationMs: number
    error?: string
  }[] = []
  const check = async (name: string, run: () => Promise<void>) => {
    const started = Date.now()
    try {
      await test.step(name, run)
      checks.push({ name, status: 'passed', durationMs: Date.now() - started })
    } catch (error) {
      checks.push({
        name,
        status: 'failed',
        durationMs: Date.now() - started,
        error: getErrorMessage(error),
      })
      throw error
    }
  }
  const userData = mkdtempSync(join(tmpdir(), 'sim-chat-panel-e2e-'))
  let app: Awaited<ReturnType<typeof electron.launch>> | undefined
  const errors: string[] = []
  let desktopExit: { code: number | null; signal: string | null } | null = null
  let rendererCrashed = false
  let passed = false
  let javascript = ''
  let stylesheet = ''
  const server = createServer((request, response) => {
    const path = new URL(request.url ?? '/', 'http://localhost').pathname
    if (path === '/page') {
      response.setHeader('Content-Type', 'text/html')
      response.end('<!doctype html><html><body>Native browser resize fixture</body></html>')
    } else if (path === '/fixture.js' || path === '/fixture.css') {
      response.setHeader('Content-Type', path.endsWith('.js') ? 'text/javascript' : 'text/css')
      response.end(path.endsWith('.js') ? javascript : stylesheet)
    } else if (path.startsWith('/api/')) {
      response.setHeader('Content-Type', 'application/json')
      response.end(
        path === '/api/auth/get-session'
          ? JSON.stringify({ user: { id: 'fixture-user' }, session: { id: 'fixture-session' } })
          : '{}'
      )
    } else {
      response.setHeader('Content-Type', 'text/html')
      response.setHeader(
        'Set-Cookie',
        'better-auth.session_token=fixture; HttpOnly; SameSite=Lax; Path=/'
      )
      response.end(
        '<!doctype html><html class="dark"><head><link rel="stylesheet" href="/fixture.css"></head><body style="margin:0;background:var(--bg);color:var(--text-primary)"><div id="root"></div><script src="/fixture.js"></script></body></html>'
      )
    }
  })

  try {
    await check('load the production resource panel resize hook in Electron', async () => {
      const config = await loadPostcssConfig({}, SIM_DIR)
      const cssPath = join(SIM_DIR, 'app/_styles/globals.css')
      const css = await postcss(config.plugins).process(
        `${readFileSync(cssPath, 'utf8')}\n@source ${JSON.stringify(FIXTURE)};`,
        { from: cssPath }
      )
      const bundle = await build({
        entryPoints: [FIXTURE],
        bundle: true,
        write: false,
        outfile: test.info().outputPath('fixture.js'),
        external: ['node:async_hooks'],
        banner: { js: 'var process={env:{NODE_ENV:"development"},browser:true};' },
        format: 'iife',
        platform: 'browser',
        tsconfig: join(SIM_DIR, 'tsconfig.json'),
        define: { 'process.env.NODE_ENV': '"development"' },
      })
      javascript = bundle.outputFiles.find((file) => file.path.endsWith('.js'))?.text ?? ''
      stylesheet = `${css.css}\n${bundle.outputFiles.find((file) => file.path.endsWith('.css'))?.text ?? ''}`
      await new Promise<void>((resolve) => server.listen(0, resolve))
      const address = server.address()
      if (!address || typeof address === 'string') throw new Error('Missing fixture address')
      app = await electron.launch({
        args: [process.env.SIM_DESKTOP_E2E_MAIN ?? '.'],
        cwd: DESKTOP_DIR,
        env: {
          ...process.env,
          SIM_DESKTOP_ORIGIN: `http://127.0.0.1:${address.port}`,
          SIM_DESKTOP_USER_DATA: userData,
        },
      })
    })
    if (!app) throw new Error('Electron did not launch')
    app.process().once('exit', (code, signal) => {
      desktopExit = { code, signal }
    })
    const shell = app
    const page = await shell.firstWindow()
    page.on('pageerror', (error) => errors.push(error.message))
    page.on('crash', () => {
      rendererCrashed = true
    })
    await shell.evaluate(({ app, BrowserWindow }) => {
      const window = BrowserWindow.getAllWindows()[0]
      // Keep the physical window inside the small displays used by macOS CI.
      window.setMinimumSize(0, 0)
      window.setContentSize(720, 400)
      window.webContents.setBackgroundThrottling(false)
      app.focus({ steal: true })
      window.focus()
    })
    await page.reload()
    await shell.evaluate(({ app, BrowserWindow }) => {
      const window = BrowserWindow.getAllWindows()[0]
      window.webContents.setZoomFactor(0.5)
      app.focus({ steal: true })
      window.focus()
    })
    expect(errors).toEqual([])
    await expect
      .poll(() =>
        shell.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].isFocused())
      )
      .toBe(true)
    await expect.poll(() => page.evaluate(() => window.innerWidth)).toBe(1440)
    const panel = page.locator('[data-mothership-panel]')
    const divider = page.getByRole('separator', { name: 'Resize resource view' })
    const width = () => panel.evaluate((element) => element.getBoundingClientRect().width)
    const expectWidth = async (expected: number) => {
      await expect.poll(width).toBeCloseTo(expected, 0)
    }
    const beginDrag = async () => {
      await shell.evaluate(({ app, BrowserWindow }) => {
        app.focus({ steal: true })
        BrowserWindow.getAllWindows()[0].focus()
      })
      await expect
        .poll(() =>
          shell.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].isFocused())
        )
        .toBe(true)
      await divider.hover({ position: { x: 4, y: 100 } })
      const rect = await panel.boundingBox()
      if (!rect) throw new Error('Missing panel bounds')
      await page.mouse.down()
      await expect
        .poll(() => divider.evaluate((element) => element.hasPointerCapture(1)))
        .toBe(true)
      return rect
    }
    const dragTo = async (target: number) => {
      const rect = await beginDrag()
      await page.mouse.move(rect.x + rect.width - target, rect.y + 100, { steps: 12 })
      await page.mouse.up()
      await expectWidth(target)
    }

    await check('a chosen width survives a settings round trip and reload', async () => {
      await expectWidth(720)
      await dragTo(620)
      await page.getByRole('button', { name: 'Settings', exact: true }).click()
      await expect(panel).toHaveCount(0)
      await page.getByRole('button', { name: 'Back', exact: true }).click()
      await expectWidth(620)
      await page.reload()
      await expectWidth(620)
    })

    await check(
      'workspace and organization chats restore independent widths without remounting',
      async () => {
        await page.getByRole('button', { name: 'workspace-chat-b', exact: true }).click()
        await expectWidth(720)
        await dragTo(830)
        await page.getByRole('button', { name: 'organization-chat-a', exact: true }).click()
        await expectWidth(720)
        await dragTo(560)
        await page.getByRole('button', { name: 'Settings', exact: true }).click()
        await page.getByRole('button', { name: 'Back', exact: true }).click()
        await expectWidth(560)
        await page.getByRole('button', { name: 'workspace-chat-a', exact: true }).click()
        await expectWidth(620)
        await page.getByRole('button', { name: 'workspace-chat-b', exact: true }).click()
        await expectWidth(830)
      }
    )

    await check(
      'collapse preserves the expanded preference, including keyboard changes',
      async () => {
        await page.getByRole('button', { name: 'Collapse resource view' }).click()
        await expectWidth(0)
        await page.getByRole('button', { name: 'Expand resource view' }).click()
        await expectWidth(830)
        await divider.focus()
        await page.keyboard.press('ArrowRight')
        await expectWidth(798)
        await page.getByRole('button', { name: 'Settings', exact: true }).click()
        await page.getByRole('button', { name: 'Back', exact: true }).click()
        await expectWidth(798)
      }
    )

    await check('container and window clamps do not overwrite the preferred width', async () => {
      await page.getByRole('button', { name: 'Resize container' }).click()
      await expectWidth(520)
      await page.getByRole('button', { name: 'Resize container' }).click()
      await expectWidth(798)
      await shell.evaluate(({ BrowserWindow }) =>
        BrowserWindow.getAllWindows()[0].setContentSize(525, 400)
      )
      await expectWidth(570)
      await page.getByRole('button', { name: 'Settings', exact: true }).click()
      await page.getByRole('button', { name: 'Back', exact: true }).click()
      await expectWidth(570)
      await shell.evaluate(({ BrowserWindow }) =>
        BrowserWindow.getAllWindows()[0].setContentSize(720, 400)
      )
      await expectWidth(798)
    })

    await check('resizing writes storage only when the gesture ends', async () => {
      const before = await page.evaluate(() => JSON.stringify(localStorage))
      const rect = await beginDrag()
      await page.mouse.move(rect.x + 100, rect.y + 100, { steps: 12 })
      await expectWidth(698)
      expect(await page.evaluate(() => JSON.stringify(localStorage))).toBe(before)
      await page.mouse.up()
      expect(await page.evaluate(() => JSON.stringify(localStorage))).not.toBe(before)
    })

    for (const interruption of [
      'pointercancel',
      'capture loss',
      'blur',
      'detach',
      'chat switch',
    ] as const) {
      await check(`${interruption} keeps the previous saved width`, async () => {
        const before = await page.evaluate(() => JSON.stringify(localStorage))
        const rect = await beginDrag()
        await page.mouse.move(rect.x + 100, rect.y + 100, { steps: 12 })
        await expectWidth(598)
        if (interruption === 'pointercancel') {
          await divider.dispatchEvent('pointercancel', { pointerId: 1 })
        } else if (interruption === 'capture loss') {
          await divider.evaluate((element) => element.releasePointerCapture(1))
          await page.mouse.move(rect.x + 101, rect.y + 100)
        } else if (interruption === 'blur') {
          await page.evaluate(() => window.dispatchEvent(new Event('blur')))
        } else if (interruption === 'chat switch') {
          await page
            .getByRole('button', { name: 'organization-chat-a', exact: true })
            .evaluate((element: HTMLButtonElement) => element.click())
          await expectWidth(560)
        } else {
          await page
            .getByRole('button', { name: 'Settings', exact: true })
            .evaluate((element: HTMLButtonElement) => element.click())
          await expect(panel).toHaveCount(0)
        }
        await page.mouse.up()
        if (interruption === 'chat switch') {
          await page.getByRole('button', { name: 'workspace-chat-b', exact: true }).click()
        }
        if (interruption === 'detach') {
          await page.getByRole('button', { name: 'Back', exact: true }).click()
        }
        await expectWidth(698)
        expect(await page.evaluate(() => JSON.stringify(localStorage))).toBe(before)
      })
    }

    await check('a viewport change during a drag clamps the committed display width', async () => {
      await page.getByRole('button', { name: 'Resize container' }).click()
      await expectWidth(520)
      const rect = await beginDrag()
      await page.mouse.move(rect.x + 20, rect.y + 100, { steps: 12 })
      await expectWidth(500)
      await shell.evaluate(({ BrowserWindow }) =>
        BrowserWindow.getAllWindows()[0].setContentSize(300, 400)
      )
      await expect.poll(() => page.evaluate(() => window.innerWidth)).toBe(600)
      await page.mouse.up()
      await expectWidth(480)
      await shell.evaluate(({ BrowserWindow }) =>
        BrowserWindow.getAllWindows()[0].setContentSize(720, 400)
      )
      await expectWidth(500)
      await page.getByRole('button', { name: 'Resize container' }).click()
      await dragTo(698)
    })

    await check('another account cannot inherit the current chat width', async () => {
      await page.getByRole('button', { name: 'Switch account' }).click()
      await expectWidth(720)
      await dragTo(580)
      await page.getByRole('button', { name: 'Switch account' }).click()
      await expectWidth(698)
    })
    await check('assigning a permanent chat ID lets an active drag finish', async () => {
      await page.getByRole('button', { name: 'pending:chat', exact: true }).click()
      await dragTo(620)
      const rect = await beginDrag()
      await page.mouse.move(rect.x + 100, rect.y + 100, { steps: 12 })
      await expectWidth(520)
      await page
        .getByRole('button', { name: 'Assign chat ID', exact: true })
        .evaluate((element: HTMLButtonElement) => element.click())
      await expect(page.getByRole('button', { name: 'Assign chat ID', exact: true })).toBeDisabled()
      expect(await divider.evaluate((element) => element.hasPointerCapture(1))).toBe(true)
      await page.mouse.up()
      await expectWidth(520)
      await page.getByRole('button', { name: 'workspace-chat-b', exact: true }).click()
      await expectWidth(698)
      await page.getByRole('button', { name: 'assigned-chat', exact: true }).click()
      await expectWidth(520)
      await page.getByRole('button', { name: 'workspace-chat-b', exact: true }).click()
      await expectWidth(698)
    })

    await check(
      'cancelling before the first animation frame restores native browser bounds',
      async () => {
        await page.getByRole('button', { name: 'pending:native', exact: true }).click()
        await dragTo(698)
        await shell.evaluate(({ app, BrowserWindow }) => {
          app.focus({ steal: true })
          BrowserWindow.getAllWindows()[0].focus()
        })
        await expect
          .poll(() =>
            shell.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].isFocused())
          )
          .toBe(true)
        await page.getByRole('button', { name: 'Start browser', exact: true }).click()
        const nativeBounds = () =>
          shell.evaluate(({ BrowserWindow, WebContentsView }) => {
            const view = BrowserWindow.getAllWindows()[0].contentView.children.find(
              (child) =>
                child instanceof WebContentsView && child.webContents.getURL().endsWith('/page')
            )
            return view?.getVisible() ? view.getBounds() : null
          })
        await expect.poll(nativeBounds).not.toBeNull()
        const before = await nativeBounds()
        await beginDrag()
        await divider.evaluate((element) => {
          const rect = element.getBoundingClientRect()
          element.dispatchEvent(
            new PointerEvent('pointermove', { pointerId: 1, clientX: rect.x + 104, bubbles: true })
          )
          element.dispatchEvent(new PointerEvent('pointercancel', { pointerId: 1, bubbles: true }))
        })
        // The bridge round trip observes main-process geometry after the queued bounds messages.
        await page.evaluate(() =>
          (
            globalThis as typeof globalThis & { simDesktop: SimDesktopApi }
          ).simDesktop.browserAgent.capturePanelSnapshot('pending:native')
        )
        await page.mouse.up()
        await expectWidth(698)
        expect(await nativeBounds()).toEqual(before)

        await check('native predictions follow a chat ID assigned during a drag', async () => {
          if (!before) throw new Error('Missing native browser bounds')
          await beginDrag()
          await page
            .getByRole('button', { name: 'Assign chat ID', exact: true })
            .evaluate((element: HTMLButtonElement) => element.click())
          await expect(
            page.getByRole('button', { name: 'Assign chat ID', exact: true })
          ).toBeDisabled()
          expect(await divider.evaluate((element) => element.hasPointerCapture(1))).toBe(true)
          await divider.evaluate((element) => {
            const rect = element.getBoundingClientRect()
            element.dispatchEvent(
              new PointerEvent('pointermove', {
                pointerId: 1,
                clientX: rect.x + 104,
                bubbles: true,
              })
            )
          })
          await page.evaluate(() =>
            (
              globalThis as typeof globalThis & { simDesktop: SimDesktopApi }
            ).simDesktop.browserAgent.capturePanelSnapshot('assigned-chat')
          )
          expect(await nativeBounds()).toEqual({
            ...before,
            x: before.x + 50,
            width: before.width - 50,
          })
          await page.mouse.up()
          await expectWidth(598)
        })
      }
    )
    expect(errors).toEqual([])
    passed = true
  } finally {
    mkdirSync(dirname(reportPath), { recursive: true })
    writeFileSync(
      reportPath,
      JSON.stringify({ passed, checks, errors, desktopExit, rendererCrashed }, null, 2)
    )
    await app?.close()
    await new Promise<void>((resolve) => server.close(() => resolve()))
    rmSync(userData, { recursive: true, force: true })
  }
})
