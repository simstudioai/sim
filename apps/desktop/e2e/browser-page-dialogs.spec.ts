import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { createServer, type Server } from 'node:http'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  type ElectronApplication,
  _electron as electron,
  expect,
  type Page,
  test,
} from '@playwright/test'
import type { BrowserPageDialog, BrowserToolName } from '@sim/browser-protocol'
import type { SimDesktopApi } from '@sim/desktop-bridge'
import { getErrorMessage } from '@sim/utils/errors'

const DESKTOP_DIR = fileURLToPath(new URL('..', import.meta.url))
const SCOPE = 'browser-page-dialogs-e2e'
const SHELL_FIXTURE = '<!doctype html><title>Sim fixture</title><h1>Browser dialogs fixture</h1>'
const FORM_FIXTURE = `<!doctype html><title>form</title>
<input id="draft" aria-label="Draft">
<button id="delete" onclick="document.title = 'confirm:' + confirm('Delete the report?')">Delete</button>
<script>addEventListener('beforeunload', (event) => {
  if (document.getElementById('draft').value) { event.preventDefault(); event.returnValue = '' }
})</script>`

type Bridge = typeof globalThis & {
  simDesktop: SimDesktopApi
  pageDialog?: BrowserPageDialog | null
  boundsTimer?: number
}

/**
 * A page's alert, confirm, and leave-site question belong to whoever is using
 * the page: the user on the tab they are looking at, the agent during its own
 * action. These checks drive the real shell and native tab views.
 */
test('page dialogs wait for the user on their page and stay automatic for the agent', async () => {
  const reportPath =
    process.env.DESKTOP_BROWSER_DIALOGS_REPORT_PATH ??
    test.info().outputPath('browser-page-dialogs.json')
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
  const calls = new Map<string, { chatId: string; toolName: BrowserToolName; args: unknown }>()
  const server: Server = createServer(async (request, response) => {
    const path = new URL(request.url ?? '/', 'http://localhost').pathname
    if (path === '/api/desktop/tool/authorize') {
      let body = ''
      for await (const chunk of request) body += chunk.toString()
      const authorization = calls.get(JSON.parse(body).toolCallId)
      response.writeHead(authorization ? 200 : 403, { 'Content-Type': 'application/json' })
      response.end(JSON.stringify(authorization ?? {}))
      return
    }
    // The app origin serves the shell; the same server on localhost is the web.
    const isSite = request.headers.host?.startsWith('localhost') === true
    response.writeHead(200, {
      'Content-Type': 'text/html',
      ...(isSite ? {} : { 'Set-Cookie': 'better-auth.session_token=fixture; HttpOnly; Path=/' }),
    })
    response.end(
      !isSite
        ? SHELL_FIXTURE
        : path === '/form' || path === '/agent'
          ? FORM_FIXTURE
          : '<!doctype html><title>next</title>'
    )
  })
  const userData = mkdtempSync(join(tmpdir(), 'sim-browser-dialogs-e2e-'))
  let app: ElectronApplication | undefined
  let passed = false
  try {
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
    const address = server.address()
    if (!address || typeof address === 'string') throw new Error('Missing fixture address')
    const origin = `http://127.0.0.1:${address.port}`
    const site = origin.replace('127.0.0.1', 'localhost')
    const shellApp = await electron.launch({
      args: [process.env.SIM_DESKTOP_E2E_MAIN ?? '.'],
      cwd: DESKTOP_DIR,
      env: { ...process.env, SIM_DESKTOP_ORIGIN: origin, SIM_DESKTOP_USER_DATA: userData },
    })
    app = shellApp
    // A dialog listener stops Playwright auto-dismissing page dialogs, so the desktop's own
    // handling decides their outcome exactly as it does in production.
    const leaveDialogsToDesktop = (page: Page) => page.on('dialog', () => {})
    shellApp.context().pages().forEach(leaveDialogsToDesktop)
    shellApp.context().on('page', leaveDialogsToDesktop)
    const shell = await shellApp.firstWindow()
    await expect(shell.getByRole('heading')).toHaveText('Browser dialogs fixture')
    await shell.evaluate(async (scope) => {
      const bridge = globalThis as Bridge
      const api = bridge.simDesktop.browserAgent
      await api.activateScope(scope)
      const updateBounds = () =>
        api.setPanelBounds(
          { x: 0, y: 80, width: innerWidth, height: innerHeight - 80 },
          null,
          scope
        )
      updateBounds()
      bridge.boundsTimer = window.setInterval(updateBounds, 200)
      bridge.pageDialog = null
      api.onPageState((state) => {
        bridge.pageDialog = state.dialog ?? null
      })
    }, SCOPE)

    let callCount = 0
    const execute = async (tool: BrowserToolName, args: Record<string, unknown>) => {
      const callId = `browser-dialogs-${++callCount}`
      calls.set(callId, { chatId: SCOPE, toolName: tool, args })
      const result = await shell.evaluate(
        ({ callId, tool, args, scope }) =>
          (globalThis as Bridge).simDesktop.browserAgent.executeTool(callId, tool, args, scope),
        { callId, tool, args, scope: SCOPE }
      )
      expect(result.ok).toBe(true)
      return result.ok ? result.result : undefined
    }
    /** Browser-chrome actions are user gestures, so each follows a real click in Sim. */
    const panelAction = async (action: Record<string, unknown>) => {
      await shell.getByRole('heading').click()
      await shell.evaluate(
        ({ action, scope }) =>
          (globalThis as Bridge).simDesktop.browserAgent.panelAction(
            action as unknown as Parameters<SimDesktopApi['browserAgent']['panelAction']>[0],
            scope
          ),
        { action, scope: SCOPE }
      )
    }
    const pageDialog = () => shell.evaluate(() => (globalThis as Bridge).pageDialog ?? null)
    const inPage = <T>(script: string) =>
      shellApp.evaluate(
        async ({ webContents }, { script, url }) =>
          (await webContents
            .getAllWebContents()
            .find((contents) => contents.getURL().startsWith(url))
            ?.executeJavaScript(script)) as T,
        { script, url: site }
      )
    /** Read from the shell: a script cannot run in a page while its dialog is open. */
    const pageTitle = () =>
      shellApp.evaluate(
        ({ webContents }, url) =>
          webContents
            .getAllWebContents()
            .find((contents) => contents.getURL().startsWith(url))
            ?.getTitle() ?? null,
        site
      )
    const pageUrl = () =>
      shellApp.evaluate(
        ({ webContents }, url) =>
          webContents
            .getAllWebContents()
            .find((contents) => contents.getURL().startsWith(url))
            ?.getURL() ?? null,
        site
      )
    /** Trusted input into the page, the way the user's own mouse and keys arrive. */
    const userInput = (selector: string, text = '') =>
      shellApp.evaluate(
        async ({ webContents }, { selector, text, url }) => {
          const contents = webContents
            .getAllWebContents()
            .find((candidate) => candidate.getURL().startsWith(url))
          if (!contents) throw new Error('No page')
          const rect: { x: number; y: number } = await contents.executeJavaScript(
            `(() => { const { x, y } = document.querySelector(${JSON.stringify(selector)}).getBoundingClientRect(); return { x, y } })()`
          )
          const point = { x: Math.round(rect.x + 5), y: Math.round(rect.y + 5) }
          contents.sendInputEvent({ type: 'mouseDown', ...point, button: 'left', clickCount: 1 })
          contents.sendInputEvent({ type: 'mouseUp', ...point, button: 'left', clickCount: 1 })
          for (const character of text)
            contents.sendInputEvent({ type: 'char', keyCode: character })
        },
        { selector, text, url: site }
      )

    await check('without a renderer that shows dialogs, the shell still answers them', async () => {
      await execute('browser_open_url', { url: `${site}/form` })
      await panelAction({ action: 'switch-tab', tabId: '1' })
      await userInput('#delete')
      await expect.poll(() => pageTitle()).toBe('confirm:false')
      expect(await pageDialog()).toBeNull()
    })

    await panelAction({ action: 'enable-page-dialogs' })
    await inPage("document.title = 'form'")

    await check("the user's confirm waits for their answer", async () => {
      await userInput('#delete')
      await expect
        .poll(pageDialog)
        .toMatchObject({ kind: 'confirm', message: 'Delete the report?' })
      expect(await pageTitle()).toBe('form')
      const dialog = await pageDialog()
      await panelAction({ action: 'respond-dialog', requestId: dialog?.requestId, allowed: true })
      await expect.poll(() => pageTitle()).toBe('confirm:true')
      await expect.poll(pageDialog).toBeNull()
    })

    await check("the agent's dialogs never wait on the user", async () => {
      await inPage("document.title = 'form'")
      const snapshot = await execute('browser_snapshot', {})
      const ref = /button "Delete" \[ref=(\d+)\]/.exec(
        String((snapshot as { outline?: string }).outline)
      )?.[1]
      expect(ref, 'snapshot lists the Delete button').toBeTruthy()
      await execute('browser_click', { elementId: Number(ref) })
      await expect.poll(() => pageTitle()).toBe('confirm:false')
      expect(await pageDialog()).toBeNull()
      await inPage("document.title = 'form'")
      await execute('browser_click', { elementId: Number(ref), dialog: { accept: true } })
      await expect.poll(() => pageTitle()).toBe('confirm:true')
      expect(await pageDialog()).toBeNull()
    })

    await check('leaving a draft from the URL bar asks, and Stay keeps it', async () => {
      await userInput('#draft', 'draft')
      await expect
        .poll(() => inPage<string>("document.getElementById('draft').value"))
        .toBe('draft')
      await panelAction({ action: 'navigate', url: `${site}/next` })
      await expect.poll(pageDialog).toMatchObject({ kind: 'beforeunload' })
      const dialog = await pageDialog()
      await panelAction({ action: 'respond-dialog', requestId: dialog?.requestId, allowed: false })
      await expect.poll(pageDialog).toBeNull()
      expect(await pageUrl()).toBe(`${site}/form`)
      expect(await inPage<string>("document.getElementById('draft').value")).toBe('draft')
    })

    await check('Reload of a draft asks too, and Stay keeps it', async () => {
      await panelAction({ action: 'reload' })
      await expect.poll(pageDialog).toMatchObject({ kind: 'beforeunload' })
      const dialog = await pageDialog()
      await panelAction({ action: 'respond-dialog', requestId: dialog?.requestId, allowed: false })
      await expect.poll(pageDialog).toBeNull()
      expect(await inPage<string>("document.getElementById('draft').value")).toBe('draft')
    })

    await check('Leave lets the navigation through without asking again', async () => {
      await panelAction({ action: 'navigate', url: `${site}/next` })
      await expect.poll(pageDialog).toMatchObject({ kind: 'beforeunload' })
      const dialog = await pageDialog()
      await panelAction({ action: 'respond-dialog', requestId: dialog?.requestId, allowed: true })
      await expect.poll(pageUrl).toBe(`${site}/next`)
      expect(await pageDialog()).toBeNull()
    })
    /** Opens a page-initiated confirm (no user gesture) on the tab at `path`. */
    const confirmFromPage = (path: string) =>
      shellApp.evaluate(({ webContents }, url) => {
        const contents = webContents.getAllWebContents().find((c) => c.getURL() === url)
        if (!contents) throw new Error(`No page at ${url}`)
        void contents.executeJavaScript(
          "setTimeout(() => { document.title = 'confirm:' + confirm('Continue?') })"
        )
      }, `${site}${path}`)
    const titleAt = (path: string) =>
      shellApp.evaluate(
        ({ webContents }, url) =>
          webContents
            .getAllWebContents()
            .find((c) => c.getURL() === url)
            ?.getTitle() ?? null,
        `${site}${path}`
      )

    await check(
      "a dialog on the agent's page stays automatic until the user takes it",
      async () => {
        await execute('browser_open_tab', { url: `${site}/agent` })
        const tabs = await shell.evaluate(
          async (scope) =>
            (await (globalThis as Bridge).simDesktop.browserAgent.activateScope(scope)).tabs,
          SCOPE
        )
        const agentTabId = tabs.find((tab) => tab.url === `${site}/agent`)?.tabId
        // The resource strip mirrors the agent's tab on screen without the user claiming it.
        await panelAction({ action: 'switch-tab', tabId: agentTabId, claim: false })
        await confirmFromPage('/agent')
        await expect.poll(() => titleAt('/agent')).toBe('confirm:false')
        expect(await pageDialog()).toBeNull()
      }
    )

    await check('a dialog while the browser is off screen stays automatic', async () => {
      await shell.evaluate((scope) => {
        const bridge = globalThis as Bridge
        window.clearInterval(bridge.boundsTimer)
        bridge.simDesktop.browserAgent.setPanelBounds(null, null, scope)
      }, SCOPE)
      await confirmFromPage('/agent')
      await expect.poll(() => titleAt('/agent')).toBe('confirm:false')
      expect(await pageDialog()).toBeNull()
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
