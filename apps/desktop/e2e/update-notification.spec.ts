import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { createServer } from 'node:http'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { _electron as electron, expect, test } from '@playwright/test'
import type { DesktopUpdateState } from '@sim/desktop-bridge'
import { getErrorMessage } from '@sim/utils/errors'
import { sleep } from '@sim/utils/helpers'
import { build } from 'esbuild'
import postcss from 'postcss'
import loadPostcssConfig from 'postcss-load-config'

const DESKTOP_DIR = fileURLToPath(new URL('..', import.meta.url))
const SIM_DIR = fileURLToPath(new URL('../../sim/', import.meta.url))
const FIXTURE = fileURLToPath(new URL('./fixtures/update-notification.tsx', import.meta.url))

test('desktop update actions survive navigation without repeating dismissed or stale offers', async () => {
  const reportPath =
    process.env.DESKTOP_UPDATE_NOTICE_REPORT_PATH ?? test.info().outputPath('update-notice.json')
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
  const userData = mkdtempSync(join(tmpdir(), 'sim-update-notice-e2e-'))
  let app: Awaited<ReturnType<typeof electron.launch>> | undefined
  let passed = false
  let javascript = ''
  let stylesheet = ''
  const server = createServer((request, response) => {
    const path = new URL(request.url ?? '/', 'http://localhost').pathname
    if (path === '/fixture.js' || path === '/fixture.css') {
      response.setHeader('Content-Type', path.endsWith('.js') ? 'text/javascript' : 'text/css')
      response.end(path.endsWith('.js') ? javascript : stylesheet)
    } else if (path.startsWith('/api/')) {
      response.setHeader('Content-Type', 'application/json')
      response.end('{}')
    } else {
      response.setHeader('Content-Type', 'text/html')
      response.end(
        '<!doctype html><html class="dark"><head><link rel="stylesheet" href="/fixture.css"></head><body style="margin:0;background:var(--bg);color:var(--text-primary)"><div id="root"></div><script src="/fixture.js"></script></body></html>'
      )
    }
  })

  try {
    await check('load the production notification in Electron', async () => {
      const config = await loadPostcssConfig({}, SIM_DIR)
      const cssPath = join(SIM_DIR, 'app/_styles/globals.css')
      const css = await postcss(config.plugins).process(
        `${readFileSync(cssPath, 'utf8')}\n@source ${JSON.stringify(FIXTURE)};`,
        { from: cssPath }
      )
      const bundle = await build({
        stdin: {
          contents: `import { mountUpdateNotificationFixture } from ${JSON.stringify(FIXTURE)};
import { DesktopUpdateNotification } from '@/app/_shell/desktop-update-notification';
mountUpdateNotificationFixture(DesktopUpdateNotification);`,
          resolveDir: SIM_DIR,
          loader: 'tsx',
        },
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
      await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
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
    const shell = app
    const page = await shell.firstWindow()
    const errors: string[] = []
    page.on('pageerror', (error) => errors.push(error.message))
    await shell.evaluate(({ app, BrowserWindow }) => {
      const window = BrowserWindow.getAllWindows()[0]
      window.setContentSize(1000, 700)
      window.webContents.setBackgroundThrottling(false)
      app.focus({ steal: true })
      window.focus()
    })
    const publish = (state: DesktopUpdateState) =>
      shell.evaluate(({ BrowserWindow }, next) => {
        BrowserWindow.getAllWindows()[0].webContents.send('desktop:updates:state', next)
      }, state)
    const notice = page.getByRole('list', { name: 'Notifications' })
    const restart = notice.getByRole('button', { name: 'Restart to update' })
    const download = notice.getByRole('button', { name: 'Download update' })

    await check(
      'initial snapshot survives StrictMode and remains actionable across navigation',
      async () => {
        await shell.evaluate(({ ipcMain }) => {
          ipcMain.removeHandler('desktop:updates:get-state')
          ipcMain.handle('desktop:updates:get-state', () => ({ status: 'ready', version: '2.0.0' }))
        })
        await page.reload()
        await expect(restart).toHaveCount(1)
        await expect(restart).toBeVisible()
        await page.getByRole('button', { name: 'Switch workspace' }).click()
        await expect(page.getByLabel('Current route')).toHaveText('/workspace/second')
        await sleep(5_500)
        await expect(restart).toBeVisible()
        await page.screenshot({
          path: test.info().outputPath('update-ready-dark.png'),
          animations: 'disabled',
        })
        await page.evaluate(() => document.documentElement.classList.remove('dark'))
        await page.screenshot({
          path: test.info().outputPath('update-ready-light.png'),
          animations: 'disabled',
        })
      }
    )

    await check('dismissal survives repeated events and checking the same release', async () => {
      await notice.getByRole('button', { name: 'Dismiss notification' }).click()
      await expect(restart).toHaveCount(0)
      await publish({ status: 'ready', version: '2.0.0' })
      await publish({ status: 'checking', version: '2.0.0' })
      await page.evaluate(
        () =>
          new Promise<void>((resolve) =>
            requestAnimationFrame(() => requestAnimationFrame(() => resolve()))
          )
      )
      await publish({ status: 'ready', version: '2.0.0' })
      await sleep(500)
      await expect(restart).toHaveCount(0)
    })

    await check(
      'a new release appears without stealing focus, and stale actions are withdrawn',
      async () => {
        const input = page.getByRole('textbox', { name: 'Work in progress' })
        await input.fill('Unsaved work')
        await publish({ status: 'ready', version: '2.1.0' })
        await expect(restart).toBeVisible()
        await expect(input).toBeFocused()
        for (const status of ['checking', 'downloading', 'error', 'idle'] as const) {
          await publish({ status, version: '2.1.0' })
          await expect(restart).toHaveCount(0)
          await publish({ status: 'ready', version: '2.1.0' })
          await expect(restart).toHaveCount(1)
        }
        await expect(input).toHaveValue('Unsaved work')
      }
    )

    await check(
      'a dismissed download offer can announce that the same release is ready',
      async () => {
        await publish({ status: 'available', version: '2.1.0' })
        await expect(download).toBeVisible()
        await expect(restart).toHaveCount(0)
        await notice.getByRole('button', { name: 'Dismiss notification' }).click()
        await expect(download).toHaveCount(0)
        await publish({ status: 'ready', version: '2.1.0' })
        await expect(restart).toBeVisible()
      }
    )

    await check('stack eviction does not count as dismissing the update offer', async () => {
      await publish({ status: 'checking', version: '2.4.0' })
      await expect(restart).toHaveCount(0)
      await publish({ status: 'ready', version: '2.4.0' })
      await expect(restart).toHaveCount(1)
      await page.getByRole('button', { name: 'Fill notification stack' }).click()
      await expect(restart).toHaveCount(0)
      await page.getByRole('button', { name: 'Clear notifications' }).click()
      await expect(notice).toHaveCount(0)
      await publish({ status: 'checking', version: '2.4.0' })
      await page.evaluate(
        () =>
          new Promise<void>((resolve) =>
            requestAnimationFrame(() => requestAnimationFrame(() => resolve()))
          )
      )
      await publish({ status: 'ready', version: '2.4.0' })
      await expect(restart).toBeVisible()
    })

    await check('actions reach the real preload IPC with the correct operation', async () => {
      for (const { state, action, channel } of [
        {
          state: { status: 'ready', version: '2.4.0' },
          action: restart,
          channel: 'desktop:updates:install',
        },
        {
          state: { status: 'available', version: '2.5.0' },
          action: download,
          channel: 'desktop:updates:check',
        },
        {
          state: { status: 'available', version: '2.6.0', manual: true },
          action: download,
          channel: 'desktop:updates:install',
        },
      ] satisfies { state: DesktopUpdateState; action: typeof restart; channel: string }[]) {
        await publish(state)
        await expect(action).toBeVisible()
        const received = await shell.evaluateHandle(({ ipcMain }, name) => {
          const receipt: { url: string | null } = { url: null }
          ipcMain.once(name, (event) => {
            receipt.url = event.sender.getURL()
          })
          return receipt
        }, channel)
        try {
          await action.click()
          await expect.poll(() => received.evaluate((receipt) => receipt.url)).toBe(page.url())
          await expect(action).toHaveCount(0)
        } finally {
          await received.dispose()
        }
      }
      expect(errors).toEqual([])
    })
    passed = true
  } finally {
    mkdirSync(dirname(reportPath), { recursive: true })
    writeFileSync(reportPath, JSON.stringify({ passed, checks }, null, 2))
    await app?.close()
    await new Promise<void>((resolve) => server.close(() => resolve()))
    rmSync(userData, { recursive: true, force: true })
  }
})
