import { fileURLToPath } from 'node:url'
import type { DesktopUpdateState } from '@sim/desktop-bridge'
import { bundleSimFixture, type DesktopBridge, expect, serve, test } from './harness'

const FIXTURE = fileURLToPath(new URL('./fixtures/update-notification.tsx', import.meta.url))

test('desktop update actions survive navigation without repeating dismissed or stale offers', async ({
  desktop,
}) => {
  const { js, css } = await bundleSimFixture({
    source: `import { mountUpdateNotificationFixture } from ${JSON.stringify(FIXTURE)};
import { DesktopUpdateNotification } from '@/app/_shell/desktop-update-notification';
mountUpdateNotificationFixture(DesktopUpdateNotification);`,
  })
  const fixture = await serve((_request, response, url) => {
    if (url.pathname === '/fixture.js' || url.pathname === '/fixture.css') {
      const script = url.pathname.endsWith('.js')
      response.writeHead(200, { 'Content-Type': script ? 'text/javascript' : 'text/css' })
      response.end(script ? js : css)
    } else if (url.pathname.startsWith('/api/')) {
      response.writeHead(200, { 'Content-Type': 'application/json' }).end('{}')
    } else {
      response.writeHead(200, { 'Content-Type': 'text/html' })
      response.end(
        '<!doctype html><html class="dark"><head><link rel="stylesheet" href="/fixture.css"></head><body style="margin:0;background:var(--bg);color:var(--text-primary)"><div id="root"></div><script src="/fixture.js"></script></body></html>'
      )
    }
  })
  try {
    const { app } = await desktop.launch({
      origin: fixture.origin,
    })
    const page = await app.firstWindow()
    const errors: string[] = []
    page.on('pageerror', (error) => errors.push(error.message))
    await app.evaluate(({ app, BrowserWindow }) => {
      const window = BrowserWindow.getAllWindows()[0]
      window.setContentSize(1000, 700)
      window.webContents.setBackgroundThrottling(false)
      app.focus({ steal: true })
      window.focus()
    })
    const publish = (state: DesktopUpdateState) =>
      app.evaluate(({ BrowserWindow }, next) => {
        BrowserWindow.getAllWindows()[0].webContents.send('desktop:updates:state', next)
      }, state)
    /** How many update states the page has received since it last loaded. */
    const delivered = () =>
      page.evaluate(() => (globalThis as { updateStatesDelivered?: number }).updateStatesDelivered)
    const countDeliveries = () =>
      page.evaluate(() => {
        const state = globalThis as { updateStatesDelivered?: number }
        state.updateStatesDelivered = 0
        ;(globalThis as DesktopBridge).simDesktop.updates.onState(() => {
          state.updateStatesDelivered = (state.updateStatesDelivered ?? 0) + 1
        })
      })
    const nextFrames = () =>
      page.evaluate(
        () =>
          new Promise<void>((resolve) =>
            requestAnimationFrame(() => requestAnimationFrame(() => resolve()))
          )
      )
    const notice = page.getByRole('list', { name: 'Notifications' })
    const restart = notice.getByRole('button', { name: 'Restart to update' })
    const download = notice.getByRole('button', { name: 'Download update' })

    await test.step('initial snapshot survives StrictMode and remains actionable across navigation', async () => {
      await app.evaluate(({ ipcMain }) => {
        ipcMain.removeHandler('desktop:updates:get-state')
        ipcMain.handle('desktop:updates:get-state', () => ({ status: 'ready', version: '2.0.0' }))
      })
      await page.reload()
      await expect(restart).toHaveCount(1)
      await expect(restart).toBeVisible()
      await page.getByRole('button', { name: 'Switch workspace' }).click()
      await expect(page.getByLabel('Current route')).toHaveText('/workspace/second')
      // Outlasts the 5s default toast lifetime: proving a real timer doesn't dismiss the notice needs
      // its real duration, and a fake clock would also freeze the dismiss animations used below.
      await page.waitForTimeout(5_500)
      await expect(restart).toBeVisible()
    })

    await test.step('dismissal survives repeated events and checking the same release', async () => {
      await notice.getByRole('button', { name: 'Dismiss notification' }).click()
      await expect(restart).toHaveCount(0)
      await countDeliveries()
      await publish({ status: 'ready', version: '2.0.0' })
      await publish({ status: 'checking', version: '2.0.0' })
      await nextFrames()
      await publish({ status: 'ready', version: '2.0.0' })
      await expect.poll(delivered).toBe(3)
      await nextFrames()
      await expect(restart).toHaveCount(0)
    })

    await test.step('a new release appears without stealing focus, and stale actions are withdrawn', async () => {
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
    })

    await test.step('a dismissed download offer can announce that the same release is ready', async () => {
      await publish({ status: 'available', version: '2.1.0' })
      await expect(download).toBeVisible()
      await expect(restart).toHaveCount(0)
      await notice.getByRole('button', { name: 'Dismiss notification' }).click()
      await expect(download).toHaveCount(0)
      await publish({ status: 'ready', version: '2.1.0' })
      await expect(restart).toBeVisible()
    })

    await test.step('stack eviction does not count as dismissing the update offer', async () => {
      await publish({ status: 'checking', version: '2.4.0' })
      await expect(restart).toHaveCount(0)
      await publish({ status: 'ready', version: '2.4.0' })
      await expect(restart).toHaveCount(1)
      await page.getByRole('button', { name: 'Fill notification stack' }).click()
      await expect(restart).toHaveCount(0)
      await page.getByRole('button', { name: 'Clear notifications' }).click()
      await expect(notice).toHaveCount(0)
      await publish({ status: 'checking', version: '2.4.0' })
      await nextFrames()
      await publish({ status: 'ready', version: '2.4.0' })
      await expect(restart).toBeVisible()
    })

    await test.step('actions reach the real preload IPC with the correct operation', async () => {
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
        const received = await app.evaluateHandle(({ ipcMain }, name) => {
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
    })
    expect(errors).toEqual([])
  } finally {
    await fixture.close()
  }
})
