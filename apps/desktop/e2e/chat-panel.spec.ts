import { fileURLToPath } from 'node:url'
import { bundleSimFixture, type DesktopBridge, expect, test } from './harness'
import { serveSignedIn } from './session-fixture'

const FIXTURE = fileURLToPath(new URL('../../sim/scripts/fixtures/chat-panel.tsx', import.meta.url))

test('chat panel sizes survive navigation, chat switches, collapse, and layout constraints', async ({
  desktop,
}) => {
  const { js, css } = await bundleSimFixture({ file: FIXTURE })
  const fixture = await serveSignedIn({
    page: '<!doctype html><html class="dark"><head><link rel="stylesheet" href="/fixture.css"></head><body style="margin:0;background:var(--bg);color:var(--text-primary)"><div id="root"></div><script src="/fixture.js"></script></body></html>',
    handle: (_request, response, url) => {
      if (url.pathname === '/page') {
        response.writeHead(200, { 'Content-Type': 'text/html' })
        response.end('<!doctype html><html><body>Native browser resize fixture</body></html>')
        return true
      }
      if (url.pathname === '/fixture.js' || url.pathname === '/fixture.css') {
        const script = url.pathname.endsWith('.js')
        response.writeHead(200, { 'Content-Type': script ? 'text/javascript' : 'text/css' })
        response.end(script ? js : css)
        return true
      }
      return false
    },
  })
  try {
    const { app } = await desktop.launch({
      origin: fixture.origin,
    })
    const page = await app.firstWindow()
    const errors: string[] = []
    page.on('pageerror', (error) => errors.push(error.message))
    const inputSession = await page.context().newCDPSession(page)
    const focusShell = async () => {
      await app.evaluate(({ app, BrowserWindow }) => {
        app.focus({ steal: true })
        BrowserWindow.getAllWindows()[0].focus()
      })
      await expect
        .poll(() =>
          app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].isFocused())
        )
        .toBe(true)
    }
    await app.evaluate(({ BrowserWindow }) => {
      const window = BrowserWindow.getAllWindows()[0]
      // Keep the physical window inside the small displays used by macOS CI.
      window.setMinimumSize(0, 0)
      window.setContentSize(720, 400)
      window.webContents.setBackgroundThrottling(false)
    })
    await page.reload()
    await app.evaluate(({ BrowserWindow }) =>
      BrowserWindow.getAllWindows()[0].webContents.setZoomFactor(0.5)
    )
    expect(errors).toEqual([])
    await focusShell()
    await expect.poll(() => page.evaluate(() => window.innerWidth)).toBe(1440)
    const storage = () => page.evaluate(() => JSON.stringify(localStorage))
    const panel = page.locator('[data-mothership-panel]')
    const divider = page.getByRole('separator', { name: 'Resize resource view' })
    const width = () => panel.evaluate((element) => element.getBoundingClientRect().width)
    const expectWidth = async (expected: number) => {
      await expect.poll(width).toBeCloseTo(expected, 0)
    }
    const beginDrag = async () => {
      await focusShell()
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

    await test.step('a chosen width survives a settings round trip and reload', async () => {
      await expectWidth(720)
      await dragTo(620)
      await page.getByRole('button', { name: 'Settings', exact: true }).click()
      await expect(panel).toHaveCount(0)
      await page.getByRole('button', { name: 'Back', exact: true }).click()
      await expectWidth(620)
      await page.reload()
      await expectWidth(620)
    })

    await test.step('workspace and organization chats restore independent widths without remounting', async () => {
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
    })

    await test.step('collapse preserves the expanded preference, including keyboard changes', async () => {
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
    })

    await test.step('container and window clamps do not overwrite the preferred width', async () => {
      await page.getByRole('button', { name: 'Resize container' }).click()
      await expectWidth(520)
      await page.getByRole('button', { name: 'Resize container' }).click()
      await expectWidth(798)
      await app.evaluate(({ BrowserWindow }) =>
        BrowserWindow.getAllWindows()[0].setContentSize(525, 400)
      )
      await expectWidth(570)
      await page.getByRole('button', { name: 'Settings', exact: true }).click()
      await page.getByRole('button', { name: 'Back', exact: true }).click()
      await expectWidth(570)
      await app.evaluate(({ BrowserWindow }) =>
        BrowserWindow.getAllWindows()[0].setContentSize(720, 400)
      )
      await expectWidth(798)
    })

    await test.step('resizing writes storage only when the gesture ends', async () => {
      const before = await storage()
      const rect = await beginDrag()
      await page.mouse.move(rect.x + 100, rect.y + 100, { steps: 12 })
      await expectWidth(698)
      expect(await storage()).toBe(before)
      await page.mouse.up()
      await expect.poll(storage).not.toBe(before)
    })

    for (const interruption of [
      'pointercancel',
      'capture loss',
      'blur',
      'detach',
      'chat switch',
    ] as const) {
      const keepsDraggedWidth = interruption === 'capture loss' || interruption === 'blur'
      await test.step(`${interruption} keeps the ${keepsDraggedWidth ? 'dragged' : 'previous saved'} width`, async () => {
        const before = await storage()
        const rect = await beginDrag()
        await page.mouse.move(rect.x + 100, rect.y + 100, { steps: 12 })
        await expectWidth(598)
        if (interruption === 'pointercancel') {
          await divider.dispatchEvent('pointercancel', { pointerId: 1 })
        } else if (interruption === 'capture loss') {
          await divider.evaluate((element) => element.releasePointerCapture(1))
          await page.mouse.move(rect.x + 100, rect.y + 100)
        } else if (interruption === 'blur') {
          // Reloads restore Playwright's focus emulation; native blur must reach the document.
          await inputSession.send('Emulation.setFocusEmulationEnabled', { enabled: false })
          await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].blur())
          await expect.poll(() => page.evaluate(() => document.hasFocus())).toBe(false)
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
        if (keepsDraggedWidth) {
          await expectWidth(598)
          await expect.poll(storage).not.toBe(before)
          if (interruption === 'blur') {
            await app.evaluate(({ app, BrowserWindow }) => {
              app.focus({ steal: true })
              BrowserWindow.getAllWindows()[0].focus()
            })
          }
          await page.mouse.move(rect.x + 150, rect.y + 100)
          await expectWidth(598)
        }
        await page.mouse.up()
        if (interruption === 'chat switch') {
          await page.getByRole('button', { name: 'workspace-chat-b', exact: true }).click()
        }
        if (interruption === 'detach') {
          await page.getByRole('button', { name: 'Back', exact: true }).click()
        }
        await expectWidth(keepsDraggedWidth ? 598 : 698)
        if (keepsDraggedWidth) {
          await page.reload()
          await page.getByRole('button', { name: 'workspace-chat-b', exact: true }).click()
          await expectWidth(598)
          await dragTo(698)
        } else {
          expect(await storage()).toBe(before)
        }
      })
    }

    for (const button of ['middle', 'right'] as const) {
      await test.step(`${button}-button drags leave the panel width unchanged`, async () => {
        const before = await storage()
        await divider.hover({ position: { x: 4, y: 100 } })
        const rect = await panel.boundingBox()
        if (!rect) throw new Error('Missing panel bounds')
        await page.mouse.down({ button })
        await page.mouse.move(rect.x + 100, rect.y + 100, { steps: 12 })
        await page.mouse.up({ button })
        await expectWidth(698)
        expect(await storage()).toBe(before)
      })
    }

    await test.step('a touch drag resizes the panel without becoming a scroll gesture', async () => {
      const rect = await panel.boundingBox()
      if (!rect) throw new Error('Missing panel bounds')
      await inputSession.send('Emulation.setTouchEmulationEnabled', { enabled: true })
      await inputSession.send('Input.dispatchTouchEvent', {
        type: 'touchStart',
        touchPoints: [{ x: rect.x, y: rect.y + 100 }],
      })
      for (let offset = 10; offset <= 100; offset += 10) {
        await inputSession.send('Input.dispatchTouchEvent', {
          type: 'touchMove',
          touchPoints: [{ x: rect.x + offset, y: rect.y + 100 }],
        })
      }
      await inputSession.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] })
      await inputSession.send('Emulation.setTouchEmulationEnabled', { enabled: false })
      await expectWidth(598)
      await page.reload()
      await page.getByRole('button', { name: 'workspace-chat-b', exact: true }).click()
      await expectWidth(598)
      await dragTo(698)
    })

    await test.step('a viewport change during a drag clamps the committed display width', async () => {
      await expectWidth(698)
      const rect = await beginDrag()
      await page.mouse.move(rect.x + 20, rect.y + 100, { steps: 12 })
      await expectWidth(678)
      await app.evaluate(({ BrowserWindow }) =>
        BrowserWindow.getAllWindows()[0].setContentSize(500, 400)
      )
      await expect.poll(() => page.evaluate(() => window.innerWidth)).toBe(1000)
      await page.mouse.up()
      await expectWidth(520)
      await app.evaluate(({ BrowserWindow }) =>
        BrowserWindow.getAllWindows()[0].setContentSize(720, 400)
      )
      await expectWidth(678)
      await dragTo(698)
    })

    await test.step('another account cannot inherit the current chat width', async () => {
      await page.getByRole('button', { name: 'Switch account' }).click()
      await expectWidth(720)
      await dragTo(580)
      await page.getByRole('button', { name: 'Switch account' }).click()
      await expectWidth(698)
    })
    await test.step('assigning a permanent chat ID lets an active drag finish', async () => {
      await page.getByRole('button', { name: 'pending:chat', exact: true }).click()
      await expectWidth(720)
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

    const nativeBounds = () =>
      app.evaluate(({ BrowserWindow, WebContentsView }) => {
        const view = BrowserWindow.getAllWindows()[0].contentView.children.find(
          (child) =>
            child instanceof WebContentsView && child.webContents.getURL().endsWith('/page')
        )
        return view?.getVisible() ? view.getBounds() : null
      })
    // The bridge round trip observes main-process geometry after the queued bounds messages.
    const settleBounds = (scope: string) =>
      page.evaluate(
        (scope) =>
          (globalThis as DesktopBridge).simDesktop.browserAgent.capturePanelSnapshot(scope),
        scope
      )

    const before =
      await test.step('cancelling before the first animation frame restores native browser bounds', async () => {
        await page.getByRole('button', { name: 'pending:native', exact: true }).click()
        await expectWidth(720)
        await dragTo(698)
        await focusShell()
        await page.getByRole('button', { name: 'Start browser', exact: true }).click()
        await expect.poll(nativeBounds).not.toBeNull()
        const bounds = await nativeBounds()
        if (!bounds) throw new Error('Missing native browser bounds')
        await beginDrag()
        await divider.evaluate((element) => {
          const rect = element.getBoundingClientRect()
          element.dispatchEvent(
            new PointerEvent('pointermove', { pointerId: 1, clientX: rect.x + 104, bubbles: true })
          )
          element.dispatchEvent(new PointerEvent('pointercancel', { pointerId: 1, bubbles: true }))
        })
        await settleBounds('pending:native')
        await page.mouse.up()
        await expectWidth(698)
        expect(await nativeBounds()).toEqual(bounds)
        return bounds
      })

    await test.step('native predictions follow a chat ID assigned during a drag', async () => {
      await beginDrag()
      await page
        .getByRole('button', { name: 'Assign chat ID', exact: true })
        .evaluate((element: HTMLButtonElement) => element.click())
      await expect(page.getByRole('button', { name: 'Assign chat ID', exact: true })).toBeDisabled()
      expect(await divider.evaluate((element) => element.hasPointerCapture(1))).toBe(true)
      await divider.evaluate((element) => {
        const rect = element.getBoundingClientRect()
        element.dispatchEvent(
          new PointerEvent('pointermove', { pointerId: 1, clientX: rect.x + 104, bubbles: true })
        )
      })
      await settleBounds('assigned-chat')
      expect(await nativeBounds()).toEqual({
        ...before,
        x: before.x + 50,
        width: before.width - 50,
      })
      await page.mouse.up()
      await expectWidth(598)
    })
    expect(errors).toEqual([])
  } finally {
    await fixture.close()
  }
})
