import { join } from 'node:path'
import type { Dialog, Page } from '@playwright/test'
import type { BrowserPageDialog, BrowserPanelAction, BrowserToolName } from '@sim/browser-protocol'
import {
  BROWSER_SESSION_COMPONENTS,
  focusedPageUrl,
  inPage,
  openShell,
  panelAction,
  serveShellAndSite,
  titleAt,
  userInput,
} from './browser-page'
import {
  bundleSimFixture,
  type DesktopBridge,
  expect,
  hideBrowserPanel,
  SIM_DIR,
  ToolAuthorizer,
  test,
} from './harness'

const SCOPE = 'browser-page-dialogs-e2e'
const SHELL = { heading: 'Browser dialogs fixture', top: 80 }
const FORM_FIXTURE = `<!doctype html><title>form</title>
<input id="draft" aria-label="Draft">
<button id="long-message" onclick="alert('Details '.repeat(150) + 'Final decision detail')">Long message</button>
<button id="delete" onclick="document.title = 'confirm:' + confirm('Delete the report?')">Delete</button>
<script>addEventListener('beforeunload', (event) => {
  if (document.getElementById('draft').value) { event.preventDefault(); event.returnValue = '' }
})</script>`

type FixtureGlobals = DesktopBridge & {
  pageDialog?: BrowserPageDialog | null
  pageIssue?: string | null
}

/**
 * A page's alert, confirm, and leave-site question belong to whoever is using
 * the page: the user on the tab they are looking at, the agent during its own
 * action. These checks drive the real shell and native tab views.
 */
test('page dialogs wait for the user on their page and stay automatic for the agent', async ({
  desktop,
}) => {
  const bundle = await bundleSimFixture({
    source: `import { createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { useBrowserSessionStore as store } from ${JSON.stringify(join(SIM_DIR, 'stores/browser-session/store.ts'))};
import { BrowserPageDialogModal } from ${JSON.stringify(join(BROWSER_SESSION_COMPONENTS, 'browser-page-dialog.tsx'))};
import { useBrowserPanelOcclusion } from ${JSON.stringify(join(BROWSER_SESSION_COMPONENTS, 'browser-panel-occlusion.ts'))};
const scope = ${JSON.stringify(SCOPE)};
const diag = (globalThis.escapeDiag = []);
const stamp = (what, extra) => diag.push({ what, t: Math.round(performance.now()), active: document.activeElement?.textContent?.slice(0, 20) ?? null, hasFocus: document.hasFocus(), ...extra });
const origAdd = window.addEventListener.bind(window);
const origRemove = window.removeEventListener.bind(window);
window.addEventListener = (type, fn, opts) => { if (type === 'keydown' && opts === true) stamp('lock-on'); return origAdd(type, fn, opts) };
window.removeEventListener = (type, fn, opts) => { if (type === 'keydown' && opts === true) stamp('lock-off'); return origRemove(type, fn, opts) };
origAdd('keydown', (e) => { if (e.key === 'Escape') stamp('esc-window-capture') }, true);
document.addEventListener('keydown', (e) => { if (e.key === 'Escape') stamp('esc-document-capture') }, true);
document.addEventListener('keydown', (e) => { if (e.key === 'Escape') stamp('esc-document-bubble', { prevented: e.defaultPrevented }) });
document.addEventListener('focusin', () => stamp('focusin'), true);
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
  })
  const authorizer = new ToolAuthorizer('browser-dialogs')
  const server = await serveShellAndSite({
    ...SHELL,
    bundle,
    authorizer,
    site: (_request, response, url) => {
      if (url.pathname === '/broken') {
        response.destroy()
        return
      }
      response.writeHead(200, { 'Content-Type': 'text/html' })
      response.end(
        url.pathname === '/form' || url.pathname === '/agent'
          ? FORM_FIXTURE
          : '<!doctype html><title>next</title>'
      )
    },
  })
  try {
    const { site } = server
    const form = `${site}/form`
    const { app } = await desktop.launch({ origin: server.origin })
    // A dialog listener stops Playwright auto-dismissing page dialogs, so the desktop's own
    // handling decides their outcome exactly as it does in production.
    const nativeDialogs: Dialog[] = []
    const captureDialogs = (page: Page) => page.on('dialog', (dialog) => nativeDialogs.push(dialog))
    app.context().pages().forEach(captureDialogs)
    app.context().on('page', captureDialogs)
    const nextNativeDialog = async () => {
      await expect.poll(() => nativeDialogs.length).toBeGreaterThan(0)
      const dialog = nativeDialogs.shift()
      if (!dialog) throw new Error('Missing native dialog')
      return dialog
    }
    const shell = await openShell(app, SCOPE, SHELL)

    const execute = (tool: BrowserToolName, args: Record<string, unknown> = {}) =>
      authorizer.execute(shell, SCOPE, tool, args)
    const pageDialog = () => shell.evaluate(() => (globalThis as FixtureGlobals).pageDialog ?? null)
    const act = async (action: BrowserPanelAction) => {
      // The store holds a dialog before its modal finishes the native-surface handshake and
      // renders, so a live dialog is answered through the modal once it appears.
      if (
        action.action === 'respond-dialog' &&
        (await pageDialog())?.requestId === action.requestId
      ) {
        await shell
          .getByRole('button', { name: action.allowed ? 'Leave' : 'Stay', exact: true })
          .click()
        return
      }
      await panelAction(shell, SCOPE, action)
    }
    const formTitle = () => titleAt(app, form)
    const draft = (url = form) => inPage<string>(app, url, "document.getElementById('draft').value")
    /** Types into the draft field and waits until the queued keys have landed. */
    const typeDraft = async (text: string) => {
      const before = await draft()
      await userInput(app, form, '#draft', text)
      await expect.poll(() => draft()).toBe(before + text)
    }
    /** The URL of the one tab on the fixture site, whichever page it is showing. */
    const pageUrl = () =>
      app.evaluate(
        ({ webContents }, site) =>
          webContents
            .getAllWebContents()
            .find((contents) => contents.getURL().startsWith(site))
            ?.getURL() ?? null,
        site
      )
    const answerLeave = async (allowed: boolean) => {
      await expect.poll(pageDialog).toMatchObject({ kind: 'beforeunload' })
      const dialog = await pageDialog()
      await act({ action: 'respond-dialog', requestId: dialog?.requestId, allowed })
    }

    await test.step('without a renderer that shows dialogs, the shell still answers them', async () => {
      await execute('browser_open_url', { url: form })
      await act({ action: 'switch-tab', tabId: '1' })
      await userInput(app, form, '#delete')
      await expect.poll(formTitle).toBe('confirm:false')
      expect(await pageDialog()).toBeNull()
    })

    await act({ action: 'enable-page-dialogs' })
    await inPage(app, form, "document.title = 'form'")
    nativeDialogs.length = 0

    await test.step("the user's confirm waits for their answer without a duplicate modal", async () => {
      await userInput(app, form, '#delete')
      const dialog = await nextNativeDialog()
      expect(dialog.type()).toBe('confirm')
      expect(dialog.message()).toBe('Delete the report?')
      expect(await formTitle()).toBe('form')
      expect(await pageDialog()).toBeNull()
      await expect(shell.getByRole('dialog')).toHaveCount(0)
      await dialog.accept()
      await expect.poll(formTitle).toBe('confirm:true')
    })

    await test.step('a user sees the complete decision text beyond the diagnostic limit', async () => {
      await userInput(app, form, '#long-message')
      const dialog = await nextNativeDialog()
      expect(dialog.message()).toBe(`${'Details '.repeat(150)}Final decision detail`)
      await dialog.accept()
    })

    await test.step('automation leaves a user-owned confirmation unanswered', async () => {
      await inPage(app, form, "document.title = 'form'")
      await userInput(app, form, '#delete')
      const dialog = await nextNativeDialog()
      const callId = authorizer.issue(SCOPE, 'browser_snapshot', {})
      const result = await shell.evaluate(
        ({ callId, scope }) =>
          (globalThis as DesktopBridge).simDesktop.browserAgent.executeTool(
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
          (globalThis as DesktopBridge).simDesktop.browserAgent.cancelTool?.(callId, scope),
        { callId, scope: SCOPE }
      )
      expect(await formTitle()).toBe('form')
      await dialog.accept()
      await expect.poll(formTitle).toBe('confirm:true')
    })

    await test.step("the agent's dialogs never wait on the user", async () => {
      await inPage(app, form, "document.title = 'form'")
      const snapshot = await execute('browser_snapshot')
      const ref = /button "Delete" \[ref=(\d+)\]/.exec(
        String((snapshot as { outline?: string }).outline)
      )?.[1]
      expect(ref, 'snapshot lists the Delete button').toBeTruthy()
      await execute('browser_click', { elementId: Number(ref) })
      await expect.poll(formTitle).toBe('confirm:false')
      expect(await pageDialog()).toBeNull()
      await inPage(app, form, "document.title = 'form'")
      await execute('browser_click', { elementId: Number(ref), dialog: { accept: true } })
      await expect.poll(formTitle).toBe('confirm:true')
      expect(await pageDialog()).toBeNull()
    })

    // CDP answers the JavaScript call but Electron owns its native sheet. Reload
    // ends the native dialogs before testing the renderer's leave-site modal.
    await act({ action: 'reload' })
    await expect.poll(formTitle).toBe('form')

    await test.step('clean reloads and navigation never ask to discard changes', async () => {
      await inPage(app, form, "document.documentElement.dataset.reloadProbe = 'before'")
      await act({ action: 'reload' })
      await expect
        .poll(() =>
          inPage<string | undefined>(app, form, 'document.documentElement.dataset.reloadProbe')
        )
        .toBeUndefined()
      await expect.poll(formTitle).toBe('form')
      expect(await pageDialog()).toBeNull()
      await act({ action: 'navigate', url: `${site}/next` })
      await expect.poll(pageUrl).toBe(`${site}/next`)
      expect(await pageDialog()).toBeNull()
      await act({ action: 'back' })
      await expect.poll(pageUrl).toBe(form)
      expect(await pageDialog()).toBeNull()
    })

    await test.step('clearing a draft removes the leave warning', async () => {
      await typeDraft('temporary draft')
      await inPage(app, form, "document.getElementById('draft').value = ''")
      await act({ action: 'navigate', url: `${site}/next` })
      await expect.poll(pageUrl).toBe(`${site}/next`)
      expect(await pageDialog()).toBeNull()
      await act({ action: 'navigate', url: form })
      await expect.poll(pageUrl).toBe(form)
    })

    await test.step('same-page navigation preserves a draft without a leave warning', async () => {
      await typeDraft('same-page draft')
      await act({ action: 'navigate', url: `${form}#section` })
      await expect.poll(pageUrl).toBe(`${form}#section`)
      expect(await pageDialog()).toBeNull()
      expect(await draft(`${form}#section`)).toBe('same-page draft')
      await act({ action: 'back' })
      await expect.poll(pageUrl).toBe(form)
      expect(await pageDialog()).toBeNull()
      await inPage(
        app,
        form,
        `setTimeout(() => { location.href = ${JSON.stringify(`${site}/next`)} })`
      )
      await expect.poll(pageUrl).toBe(`${site}/next`)
      expect(await pageDialog()).toBeNull()
      await act({ action: 'navigate', url: form })
      await expect.poll(pageUrl).toBe(form)
    })

    await test.step('leaving a draft from the URL bar asks, and Stay keeps it', async () => {
      await typeDraft('draft')
      await act({ action: 'navigate', url: `${site}/next` })
      await answerLeave(false)
      await expect.poll(pageDialog).toBeNull()
      expect(await pageUrl()).toBe(form)
      expect(await draft()).toBe('draft')
    })

    await test.step('Reload of a draft asks too, and Stay keeps it', async () => {
      await act({ action: 'reload' })
      await answerLeave(false)
      await expect.poll(pageDialog).toBeNull()
      expect(await draft()).toBe('draft')
    })

    await test.step('Escape keeps the draft and returns typing to the page', async () => {
      const results: unknown[] = []
      await app.evaluate(({ webContents }, url) => {
        const g = globalThis as unknown as { mainEsc: unknown[] }
        g.mainEsc = []
        for (const contents of webContents.getAllWebContents()) {
          contents.on('before-input-event', (_event, input) => {
            if (input.key === 'Escape')
              g.mainEsc.push({
                url: contents.getURL().slice(0, 40),
                type: input.type,
                loading: contents.isLoadingMainFrame(),
                t: Date.now(),
              })
          })
        }
        void url
      }, form)
      for (let attempt = 0; attempt < 12; attempt++) {
        await shell.evaluate(() => {
          ;(globalThis as unknown as { escapeDiag: unknown[] }).escapeDiag.length = 0
        })
        await userInput(app, form, '#draft')
        await expect.poll(() => focusedPageUrl(app)).toBe(form)
        await act({ action: 'reload' })
        await expect(shell.getByRole('button', { name: 'Stay', exact: true })).toBeFocused()
        const shown = await pageDialog()
        const before = await app.evaluate(({ webContents, BrowserWindow }, url) => {
          const page = webContents.getAllWebContents().find((c) => c.getURL() === url)
          ;(globalThis as unknown as { mainEsc: unknown[] }).mainEsc.length = 0
          return {
            focusedContents: webContents.getFocusedWebContents()?.getURL()?.slice(0, 40) ?? null,
            focusedWindow: Boolean(BrowserWindow.getFocusedWindow()),
            pageLoading: page?.isLoading(),
            pageLoadingMain: page?.isLoadingMainFrame(),
            t: Date.now(),
          }
        }, form)
        await shell.evaluate(() => {
          ;(globalThis as unknown as { escapeDiag: { what: string }[] }).escapeDiag.push({
            what: 'pre-press',
          } as never)
        })
        await shell.keyboard.press('Escape')
        let cleared = true
        try {
          await expect.poll(pageDialog, { timeout: 5000 }).toBeNull()
        } catch {
          cleared = false
        }
        const after = await pageDialog()
        const renderer = await shell.evaluate(
          () => (globalThis as unknown as { escapeDiag: unknown[] }).escapeDiag
        )
        const main = await app.evaluate(
          () => (globalThis as unknown as { mainEsc: unknown[] }).mainEsc
        )
        results.push({
          attempt,
          cleared,
          shown: shown?.requestId,
          after: after?.requestId ?? null,
          before,
          renderer,
          main,
        })
        if (!cleared) {
          await shell.getByRole('button', { name: 'Stay', exact: true }).click()
          await expect.poll(pageDialog).toBeNull()
        }
        await expect.poll(() => focusedPageUrl(app)).toBe(form)
      }
      console.log(`ESCAPE_DIAG ${JSON.stringify(results)}`)
      const { writeFileSync, mkdirSync } = await import('node:fs')
      mkdirSync('test-results', { recursive: true })
      writeFileSync('test-results/escape-diag.json', JSON.stringify(results, null, 2))
      expect(results.filter((r) => !(r as { cleared: boolean }).cleared)).toEqual([])
    })

    await test.step('Leave lets the navigation through without asking again', async () => {
      await act({ action: 'navigate', url: `${site}/next` })
      await answerLeave(true)
      await expect.poll(pageUrl).toBe(`${site}/next`)
      expect(await pageDialog()).toBeNull()
    })

    await test.step('a crashed page drops its pending Leave decision', async () => {
      await act({ action: 'navigate', url: form })
      await expect.poll(pageUrl).toBe(form)
      await typeDraft('draft')
      await act({ action: 'reload' })
      await expect.poll(pageDialog).toMatchObject({ kind: 'beforeunload' })
      const stale = await pageDialog()
      await app.evaluate(({ webContents }, url) => {
        webContents
          .getAllWebContents()
          .find((contents) => contents.getURL() === url)
          ?.forcefullyCrashRenderer()
      }, form)
      await expect.poll(pageDialog).toBeNull()
      await act({ action: 'respond-dialog', requestId: stale?.requestId, allowed: true })
      await act({ action: 'reload' })
      await expect.poll(formTitle).toBe('form')
      await expect.poll(pageDialog).toBeNull()
    })

    await test.step('Back from a failed load does not capture a later page navigation', async () => {
      await typeDraft('draft')
      await act({ action: 'navigate', url: `${site}/broken` })
      await answerLeave(true)
      await expect
        .poll(() => shell.evaluate(() => (globalThis as FixtureGlobals).pageIssue))
        .toBe('load-error')
      await act({ action: 'back' })
      // The page navigates itself from whatever document Back left in the tab.
      const current = await pageUrl()
      if (!current) throw new Error('No page on the fixture site after Back')
      await inPage(
        app,
        current,
        `setTimeout(() => { location.href = ${JSON.stringify(`${site}/next`)} })`
      )
      await expect.poll(pageUrl).toBe(`${site}/next`)
      expect(await pageDialog()).toBeNull()
    })

    /** Opens a page-initiated confirm (no user gesture) on the tab at `url`. */
    const confirmFromPage = (url: string) =>
      inPage(
        app,
        url,
        "setTimeout(() => { document.title = 'confirm:' + confirm('Continue?') }); 'scheduled'"
      )
    const agentTabId = async () => {
      const { tabs } = await shell.evaluate(
        (scope) => (globalThis as DesktopBridge).simDesktop.browserAgent.activateScope(scope),
        SCOPE
      )
      const tabId = tabs.find((tab) => tab.url === `${site}/agent`)?.tabId
      expect(tabId, 'the agent tab is listed').toBeTruthy()
      return tabId
    }

    await test.step("a dialog on the agent's page stays automatic until the user takes it", async () => {
      await execute('browser_open_tab', { url: `${site}/agent` })
      // The resource strip mirrors the agent's tab on screen without the user claiming it.
      await act({ action: 'switch-tab', tabId: await agentTabId(), claim: false })
      await confirmFromPage(`${site}/agent`)
      await expect.poll(() => titleAt(app, `${site}/agent`)).toBe('confirm:false')
      expect(await pageDialog()).toBeNull()
    })

    await test.step('a dialog while the browser is off screen stays automatic', async () => {
      await act({ action: 'switch-tab', tabId: await agentTabId() })
      await hideBrowserPanel(shell, SCOPE)
      await inPage(app, `${site}/agent`, "document.title = 'agent'")
      await confirmFromPage(`${site}/agent`)
      await expect.poll(() => titleAt(app, `${site}/agent`)).toBe('confirm:false')
      expect(await pageDialog()).toBeNull()
    })
  } finally {
    await server.close()
  }
})
