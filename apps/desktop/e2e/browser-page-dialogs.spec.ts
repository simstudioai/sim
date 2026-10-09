import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { createServer, type Server } from 'node:http'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  type Dialog,
  type ElectronApplication,
  _electron as electron,
  expect,
  type Page,
  test,
} from '@playwright/test'
import type { BrowserPageDialog, BrowserToolName } from '@sim/browser-protocol'
import type { SimDesktopApi } from '@sim/desktop-bridge'
import { getErrorMessage } from '@sim/utils/errors'
import { build } from 'esbuild'
import postcss from 'postcss'
import loadPostcssConfig from 'postcss-load-config'

const DESKTOP_DIR = fileURLToPath(new URL('..', import.meta.url))
const SCOPE = 'browser-page-dialogs-e2e'
const SIM_DIR = fileURLToPath(new URL('../../sim/', import.meta.url))
const SHELL_FIXTURE =
  '<!doctype html><title>Sim fixture</title><link rel="stylesheet" href="/fixture.css"><h1>Browser dialogs fixture</h1><div id="root"></div><div id="native-panel" style="position:absolute;top:80px;bottom:0;left:0;right:0"></div><script src="/fixture.js"></script>'
const FORM_FIXTURE = `<!doctype html><title>form</title>
<input id="draft" aria-label="Draft">
<button id="long-message" onclick="alert('Details '.repeat(150) + 'Final decision detail')">Long message</button>
<button id="delete" onclick="document.title = 'confirm:' + confirm('Delete the report?')">Delete</button>
<script>addEventListener('beforeunload', (event) => {
  if (document.getElementById('draft').value) { event.preventDefault(); event.returnValue = '' }
})</script>`

type Bridge = typeof globalThis & {
  simDesktop: SimDesktopApi
  pageDialog?: BrowserPageDialog | null
  pageIssue?: string | null
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
  const browserComponents = join(
    SIM_DIR,
    'app/workspace/[workspaceId]/home/components/mothership-view/components/resource-content/components/browser-session'
  )
  const bundle = await build({
    stdin: {
      contents: `import { createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { useBrowserSessionStore as store } from ${JSON.stringify(join(SIM_DIR, 'stores/browser-session/store.ts'))};
import { BrowserPageDialogModal } from ${JSON.stringify(join(browserComponents, 'browser-page-dialog.tsx'))};
import { useBrowserPanelOcclusion } from ${JSON.stringify(join(browserComponents, 'browser-panel-occlusion.ts'))};
const scope = ${JSON.stringify(SCOPE)};
const api = globalThis.simDesktop.browserAgent;
api.onPageState(state => store.getState().setPageState(state));
store.subscribe(state => {
  globalThis.pageDialog = state.sessions[scope]?.pageState?.dialog ?? null;
  globalThis.pageIssue = state.sessions[scope]?.pageState?.issue?.kind ?? null;
});
function Fixture() {
  const page = store(state => state.sessions[scope]?.pageState);
  useBrowserPanelOcclusion(scope, page?.tabId ?? null, true, () => document.getElementById('native-panel')?.getBoundingClientRect() ?? null);
  return createElement(BrowserPageDialogModal, {
    dialog: page?.dialog,
    open: Boolean(page?.dialog),
    onAnswer: (requestId, allowed) => api.panelAction({action:'respond-dialog',requestId,allowed},scope),
  });
}
createRoot(document.getElementById('root')).render(createElement(Fixture));`,
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
  const config = await loadPostcssConfig({}, SIM_DIR)
  const stylesheet = join(SIM_DIR, 'app/_styles/globals.css')
  const css = await postcss(config.plugins).process(readFileSync(stylesheet, 'utf8'), {
    from: stylesheet,
  })
  const calls = new Map<string, { chatId: string; toolName: BrowserToolName; args: unknown }>()
  const server: Server = createServer(async (request, response) => {
    const path = new URL(request.url ?? '/', 'http://localhost').pathname
    if (path === '/fixture.js' || path === '/fixture.css') {
      response.setHeader('Content-Type', path.endsWith('.js') ? 'text/javascript' : 'text/css')
      response.end(
        path.endsWith('.js')
          ? bundle.outputFiles.find((file) => file.path.endsWith('.js'))?.text
          : css.css
      )
      return
    }
    if (path === '/api/desktop/tool/authorize') {
      let body = ''
      for await (const chunk of request) body += chunk.toString()
      const authorization = calls.get(JSON.parse(body).toolCallId)
      response.writeHead(authorization ? 200 : 403, { 'Content-Type': 'application/json' })
      response.end(JSON.stringify(authorization ?? {}))
      return
    }
    if (path === '/broken') {
      response.destroy()
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
    const nativeDialogs: Dialog[] = []
    const leaveDialogsToDesktop = (page: Page) =>
      page.on('dialog', (dialog) => nativeDialogs.push(dialog))
    const nextNativeDialog = async () => {
      await expect.poll(() => nativeDialogs.length).toBeGreaterThan(0)
      const dialog = nativeDialogs.shift()
      if (!dialog) throw new Error('Missing native dialog')
      return dialog
    }
    shellApp.context().pages().forEach(leaveDialogsToDesktop)
    shellApp.context().on('page', leaveDialogsToDesktop)
    const shell = await shellApp.firstWindow()
    await shellApp.evaluate(({ app, BrowserWindow }) => {
      const host = BrowserWindow.getAllWindows()[0]
      if (!host) throw new Error('Missing host window')
      app.focus({ steal: true })
      host.focus()
    })
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
      if (action.action === 'respond-dialog' && (await shell.getByRole('dialog').count())) {
        await shell
          .getByRole('button', {
            name: action.allowed ? 'Leave' : 'Stay',
            exact: true,
          })
          .click()
        return
      }
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

    nativeDialogs.length = 0
    await check("the user's confirm waits for their answer without a duplicate modal", async () => {
      await userInput('#delete')
      const dialog = await nextNativeDialog()
      expect(dialog.type()).toBe('confirm')
      expect(dialog.message()).toBe('Delete the report?')
      expect(await pageTitle()).toBe('form')
      expect(await pageDialog()).toBeNull()
      await expect(shell.getByRole('dialog')).toHaveCount(0)
      await dialog.accept()
      await expect.poll(() => pageTitle()).toBe('confirm:true')
    })

    await check('a user sees the complete decision text beyond the diagnostic limit', async () => {
      await userInput('#long-message')
      const dialog = await nextNativeDialog()
      expect(dialog.message()).toBe(`${'Details '.repeat(150)}Final decision detail`)
      await dialog.accept()
    })

    await check('automation leaves a user-owned confirmation unanswered', async () => {
      await inPage("document.title = 'form'")
      await userInput('#delete')
      const dialog = await nextNativeDialog()
      const callId = `browser-dialogs-${++callCount}`
      calls.set(callId, { chatId: SCOPE, toolName: 'browser_snapshot', args: {} })
      const result = await shell.evaluate(
        ({ callId, scope }) =>
          (globalThis as Bridge).simDesktop.browserAgent.executeTool(
            callId,
            'browser_snapshot',
            {},
            scope
          ),
        { callId, scope: SCOPE }
      )
      expect(result.ok).toBe(false)
      await shell.evaluate(
        ({ callId, scope }) =>
          (globalThis as Bridge).simDesktop.browserAgent.cancelTool?.(callId, scope),
        { callId, scope: SCOPE }
      )
      expect(await pageTitle()).toBe('form')
      await dialog.accept()
      await expect.poll(() => pageTitle()).toBe('confirm:true')
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

    // CDP answers the JavaScript call but Electron owns its native sheet. Reload
    // ends the native dialogs before testing the renderer's leave-site modal.
    await panelAction({ action: 'reload' })
    await expect.poll(() => pageTitle()).toBe('form')

    await check('clean reloads and navigation never ask to discard changes', async () => {
      await inPage("document.documentElement.dataset.reloadProbe = 'before'")
      await panelAction({ action: 'reload' })
      await expect
        .poll(() => inPage<string | undefined>('document.documentElement.dataset.reloadProbe'))
        .toBeUndefined()
      await expect.poll(() => pageTitle()).toBe('form')
      expect(await pageDialog()).toBeNull()
      await panelAction({ action: 'navigate', url: `${site}/next` })
      await expect.poll(pageUrl).toBe(`${site}/next`)
      expect(await pageDialog()).toBeNull()
      await panelAction({ action: 'back' })
      await expect.poll(pageUrl).toBe(`${site}/form`)
      expect(await pageDialog()).toBeNull()
    })

    await check('clearing a draft removes the leave warning', async () => {
      await userInput('#draft', 'temporary draft')
      await inPage("document.getElementById('draft').value = ''")
      await panelAction({ action: 'navigate', url: `${site}/next` })
      await expect.poll(pageUrl).toBe(`${site}/next`)
      expect(await pageDialog()).toBeNull()
      await panelAction({ action: 'navigate', url: `${site}/form` })
      await expect.poll(pageUrl).toBe(`${site}/form`)
    })

    await check('same-page navigation preserves a draft without a leave warning', async () => {
      await userInput('#draft', 'same-page draft')
      await panelAction({ action: 'navigate', url: `${site}/form#section` })
      await expect.poll(pageUrl).toBe(`${site}/form#section`)
      expect(await pageDialog()).toBeNull()
      expect(await inPage<string>("document.getElementById('draft').value")).toBe('same-page draft')
      await panelAction({ action: 'back' })
      await expect.poll(pageUrl).toBe(`${site}/form`)
      expect(await pageDialog()).toBeNull()
      await inPage(`setTimeout(() => { location.href = ${JSON.stringify(`${site}/next`)} })`)
      await expect.poll(pageUrl).toBe(`${site}/next`)
      expect(await pageDialog()).toBeNull()
      await panelAction({ action: 'navigate', url: `${site}/form` })
      await expect.poll(pageUrl).toBe(`${site}/form`)
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

    await check('Escape keeps the draft and returns typing to the page', async () => {
      await userInput('#draft')
      await panelAction({ action: 'reload' })
      await expect(shell.getByRole('button', { name: 'Stay', exact: true })).toBeFocused()
      await shell.getByRole('dialog').screenshot({
        path: test.info().outputPath('leave-page-modal.png'),
        animations: 'allow',
        caret: 'initial',
      })
      await expect(shell.getByRole('button', { name: 'Stay', exact: true })).toBeFocused()
      await shell.keyboard.press('Escape')
      await expect.poll(pageDialog).toBeNull()
      await expect
        .poll(() =>
          shellApp.evaluate(({ webContents }) => webContents.getFocusedWebContents()?.getURL())
        )
        .toBe(`${site}/form`)
      await shellApp.evaluate(({ webContents }) => {
        const contents = webContents.getFocusedWebContents()
        if (!contents) throw new Error('Missing focused page')
        contents.sendInputEvent({ type: 'char', keyCode: 'x' })
      })
      expect(await inPage<string>("document.getElementById('draft').value")).toBe('xdraft')
    })

    await check('Leave lets the navigation through without asking again', async () => {
      await panelAction({ action: 'navigate', url: `${site}/next` })
      await expect.poll(pageDialog).toMatchObject({ kind: 'beforeunload' })
      const dialog = await pageDialog()
      await panelAction({ action: 'respond-dialog', requestId: dialog?.requestId, allowed: true })
      await expect.poll(pageUrl).toBe(`${site}/next`)
      expect(await pageDialog()).toBeNull()
    })
    await check('a crashed page drops its pending Leave decision', async () => {
      await panelAction({ action: 'navigate', url: `${site}/form` })
      await expect.poll(pageUrl).toBe(`${site}/form`)
      await userInput('#draft', 'draft')
      await panelAction({ action: 'reload' })
      await expect.poll(pageDialog).toMatchObject({ kind: 'beforeunload' })
      const stale = await pageDialog()
      await shellApp.evaluate(({ webContents }, url) => {
        webContents
          .getAllWebContents()
          .find((contents) => contents.getURL() === url)
          ?.forcefullyCrashRenderer()
      }, `${site}/form`)
      await expect.poll(pageDialog).toBeNull()
      await panelAction({ action: 'respond-dialog', requestId: stale?.requestId, allowed: true })
      await panelAction({ action: 'reload' })
      await expect.poll(() => pageTitle()).toBe('form')
      await expect.poll(pageDialog).toBeNull()
    })

    await check('Back from a failed load does not capture a later page navigation', async () => {
      await userInput('#draft', 'draft')
      await panelAction({ action: 'navigate', url: `${site}/broken` })
      await expect.poll(pageDialog).toMatchObject({ kind: 'beforeunload' })
      const dialog = await pageDialog()
      await panelAction({ action: 'respond-dialog', requestId: dialog?.requestId, allowed: true })
      await expect
        .poll(() => shell.evaluate(() => (globalThis as Bridge).pageIssue))
        .toBe('load-error')
      await panelAction({ action: 'back' })
      await inPage(`setTimeout(() => { location.href = ${JSON.stringify(`${site}/next`)} })`)
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
      const tabs = await shell.evaluate(
        async (scope) =>
          (await (globalThis as Bridge).simDesktop.browserAgent.activateScope(scope)).tabs,
        SCOPE
      )
      const tabId = tabs.find((tab) => tab.url === `${site}/agent`)?.tabId
      expect(tabId).toBeTruthy()
      await panelAction({ action: 'switch-tab', tabId })
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
