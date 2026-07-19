/**
 * Browser-agent driver: executes the copilot's `browser_*` tools against the
 * agent browser (session.ts) and keeps the renderer's panel header fed with
 * live page state.
 *
 * Perception drives through injected page functions (element registry with a
 * structural outline). Keyboard actuation (press_key, type) goes through
 * TRUSTED CDP input events — synthetic DOM KeyboardEvents never trigger
 * default editing actions (select-all, deletion, character insertion) and are
 * ignored by code editors, so they exist only as a fallback. Clicks still use
 * injected functions (element-targeted, no coordinate math). The user needs
 * no input translation at all — the real page is embedded in the Sim window,
 * so their clicks and typing are native. Tool calls serialize through a
 * queue — one real browser can only do one thing at a time — and every call
 * is bounded by a watchdog so the Sim side always gets a response instead of
 * waiting out its own timeout against silence.
 */
import type { BrowserPageState, BrowserPanelAction, BrowserToolName } from '@sim/browser-protocol'
import { createLogger } from '@sim/logger'
import type { BrowserWindow, WebContents } from 'electron'
import * as cdp from '@/main/browser-agent/cdp'
import { ToolError } from '@/main/browser-agent/errors'
import { dispatchKeyCombo, parseKeyCombo } from '@/main/browser-agent/keyboard'
import {
  clickElement,
  collectSnapshot,
  focusElementForTyping,
  getViewportInfo,
  hoverElement,
  pageContainsText,
  pressKeyOnPage,
  readActiveElementState,
  readPageText,
  scrollPage,
  selectOptionInElement,
  typeIntoElement,
} from '@/main/browser-agent/page-functions'
import * as session from '@/main/browser-agent/session'

const logger = createLogger('BrowserAgentDriver')

const NAVIGATION_TIMEOUT_MS = 25_000
const NAVIGATION_SETTLE_MS = 400
const DEFAULT_WAIT_FOR_TIMEOUT_MS = 10_000
const MAX_WAIT_FOR_TIMEOUT_MS = 120_000
const TAKEOVER_POLL_MS = 1_500
const TAKEOVER_MAX_MS = 12 * 60 * 60 * 1000
/**
 * Hard ceiling on any single tool execution (takeover excepted): whatever
 * goes wrong, the Sim side always gets a response. Sits above the longest
 * legitimate tool (browser_wait_for caps at 120s).
 */
const TOOL_WATCHDOG_MS = 150_000

export interface DriverCallbacks {
  onPageState: (state: BrowserPageState) => void
  onSessionStatus: (alive: boolean) => void
}

let driverCallbacks: DriverCallbacks | null = null

/**
 * Page states auto-handled since the last tool result (dismissed dialogs,
 * suppressed file choosers, blocked downloads). Attached to the next tool
 * result so the model reacts to what actually happened on the page.
 */
let pendingNotices: string[] = []

function recordNotice(notice: string): void {
  if (pendingNotices.length < 10) pendingNotices.push(notice)
}

/**
 * True while browser_request_takeover waits on the user. The Done chip on the
 * chat's takeover tool row completes it via the `takeover-done` panel action;
 * the state lives here (session-level, not in the page) so it survives
 * navigations and tab switches.
 */
let takeoverActive = false
let takeoverDone = false

function pageStateFor(contents: WebContents): BrowserPageState {
  return {
    url: contents.getURL(),
    title: contents.getTitle(),
    loading: contents.isLoading(),
    canGoBack: contents.navigationHistory.canGoBack(),
    canGoForward: contents.navigationHistory.canGoForward(),
  }
}

function pushPageState(contents: WebContents): void {
  if (contents.isDestroyed()) return
  if (session.activeTab()?.view.webContents !== contents) return
  driverCallbacks?.onPageState(pageStateFor(contents))
}

/** Instruments a fresh tab: CDP dialog/chooser handling + page-state pushes. */
function instrumentTab(contents: WebContents): void {
  void cdp
    .ensureInstrumented(contents, {
      onDialog: (dialog) => {
        recordNotice(
          `The page showed a ${dialog.type} dialog ("${dialog.message}") which was auto-dismissed.`
        )
      },
      onFileChooser: () => {
        recordNotice(
          'The page opened a file picker; native file uploads are not driven by the agent — ' +
            'the user can complete the upload directly in the browser panel if needed.'
        )
      },
    })
    .catch((error) => {
      logger.warn('CDP instrumentation failed', {
        error: error instanceof Error ? error.message : String(error),
      })
    })
  for (const event of [
    'did-navigate',
    'did-navigate-in-page',
    'page-title-updated',
    'did-start-loading',
    'did-stop-loading',
  ] as const) {
    contents.on(event as 'did-navigate', () => pushPageState(contents))
  }
  driverCallbacks?.onSessionStatus(true)
}

export function initDriver(
  callbacks: DriverCallbacks,
  getMainWindow: () => BrowserWindow | null
): void {
  driverCallbacks = callbacks
  session.initSession(
    {
      onSessionClosed: () => {
        driverCallbacks?.onSessionStatus(false)
      },
      onTabCreated: instrumentTab,
      onActiveTabChanged: pushPageState,
      onDownloadBlocked: (filename) => {
        recordNotice(
          `The page tried to download "${filename}"; downloads are not supported in the agent browser, so it was blocked.`
        )
      },
    },
    getMainWindow
  )
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function str(params: Record<string, unknown>, key: string): string | undefined {
  const value = params[key]
  return typeof value === 'string' && value.length > 0 ? value : undefined
}

function num(params: Record<string, unknown>, key: string): number | undefined {
  const value = params[key]
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (typeof value === 'string' && value.trim() !== '') {
    const parsed = Number(value)
    if (Number.isFinite(parsed)) return parsed
  }
  return undefined
}

function requireStr(params: Record<string, unknown>, key: string): string {
  const value = str(params, key)
  if (value === undefined) throw new ToolError(`Missing required parameter "${key}"`)
  return value
}

function requireNum(params: Record<string, unknown>, key: string): number {
  const value = num(params, key)
  if (value === undefined) throw new ToolError(`Missing required numeric parameter "${key}"`)
  return value
}

// ---------------------------------------------------------------------------
// Page-function execution
// ---------------------------------------------------------------------------

/**
 * Serializes a self-contained page function and executes it in the page's
 * main world with JSON-encoded arguments (Electron's executeJavaScript has no
 * function+args transport like chrome.scripting).
 */
async function execInPage<Args extends unknown[], Result>(
  contents: WebContents,
  fn: (...args: Args) => Result,
  args: Args
): Promise<Result> {
  const expression = `(${String(fn)}).apply(null, ${JSON.stringify(args)})`
  try {
    return (await contents.executeJavaScript(expression, true)) as Result
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    throw new ToolError(
      `Cannot act on this page (${message}). Browser-internal pages cannot be automated — ` +
        'navigate to a regular website first.'
    )
  }
}

/** Maps sentinel `{ error: ... }` results from injected functions to ToolErrors. */
function unwrapPageResult(result: unknown): unknown {
  if (typeof result === 'object' && result !== null && 'error' in result) {
    const code = (result as { error: string }).error
    if (code === 'stale') {
      throw new ToolError(
        'That element id is stale (the page changed since the last snapshot). ' +
          'Call browser_snapshot again and use a fresh id.'
      )
    }
    if (code === 'password') {
      throw new ToolError(
        'Refusing to type into a password field. Call browser_request_takeover so the user ' +
          'can enter their credentials themselves.'
      )
    }
    if (code === 'not-editable') {
      throw new ToolError('That element is not a text input — pick an editable element.')
    }
    if (code === 'not-select') {
      throw new ToolError('That element is not a <select> dropdown.')
    }
    if (code === 'no-option') {
      const options = (result as { options?: string[] }).options ?? []
      throw new ToolError(
        `No option matched that label or value. Available options: ${options.join(', ')}`
      )
    }
  }
  return result
}

// ---------------------------------------------------------------------------
// Navigation
// ---------------------------------------------------------------------------

function waitForLoadComplete(contents: WebContents, timeoutMs: number): Promise<void> {
  return new Promise((resolve) => {
    let settled = false
    const finish = () => {
      if (settled) return
      settled = true
      contents.removeListener('did-stop-loading', finish)
      contents.removeListener('destroyed', finish)
      clearTimeout(timer)
      resolve()
    }
    const timer = setTimeout(finish, timeoutMs)
    contents.on('did-stop-loading', finish)
    contents.on('destroyed', finish)
    if (!contents.isLoading()) finish()
  })
}

async function navigationResult(contents: WebContents): Promise<Record<string, unknown>> {
  await waitForLoadComplete(contents, NAVIGATION_TIMEOUT_MS)
  await sleep(NAVIGATION_SETTLE_MS)
  if (contents.isDestroyed()) throw new ToolError('The tab was closed during navigation.')
  return { url: contents.getURL(), title: contents.getTitle() }
}

/**
 * Post-action readback so the model sees the real effect (selection size,
 * value length) instead of assuming the key "worked".
 */
async function activeElementState(contents: WebContents): Promise<Record<string, unknown>> {
  const state = await execInPage(contents, readActiveElementState, []).catch(() => null)
  return typeof state === 'object' && state !== null ? (state as Record<string, unknown>) : {}
}

// ---------------------------------------------------------------------------
// Takeover
// ---------------------------------------------------------------------------

/**
 * Hands control to the user: the page is already natively interactive in the
 * panel, and the chat's takeover tool row shows the reason with a Done chip.
 * The tool resolves when that chip sends the `takeover-done` panel action.
 * Nothing is injected into the page, so nothing covers page content and the
 * pending state survives navigations.
 */
async function runTakeover(): Promise<unknown> {
  const tab = session.ensureTab()
  const contents = tab.view.webContents
  takeoverActive = true
  takeoverDone = false

  const startedAt = Date.now()
  try {
    while (Date.now() - startedAt < TAKEOVER_MAX_MS) {
      await sleep(TAKEOVER_POLL_MS)
      if (!session.hasSession() || contents.isDestroyed()) {
        throw new ToolError(
          'The browser session was closed during takeover. Ask the user what happened, then reopen with browser_navigate.'
        )
      }
      if (takeoverDone) {
        return { completed: true, elapsedMs: Date.now() - startedAt }
      }
    }
    throw new ToolError('Takeover timed out after 12 hours without the user finishing.')
  } finally {
    takeoverActive = false
    takeoverDone = false
  }
}

// ---------------------------------------------------------------------------
// Tool implementations
// ---------------------------------------------------------------------------

async function executeToolInner(
  tool: BrowserToolName,
  params: Record<string, unknown>
): Promise<unknown> {
  switch (tool) {
    case 'browser_navigate': {
      const url = requireStr(params, 'url')
      if (!/^https?:\/\//i.test(url)) {
        throw new ToolError('URL must be absolute and start with http:// or https://')
      }
      const tab = session.ensureTab()
      const contents = tab.view.webContents
      // loadURL rejects on aborts/redirect races that are routine on real
      // sites; the settled URL/title below is the truth worth reporting.
      void contents.loadURL(url).catch(() => {})
      return await navigationResult(contents)
    }

    case 'browser_go_back':
    case 'browser_go_forward': {
      const contents = session.requireTab().view.webContents
      const history = contents.navigationHistory
      if (tool === 'browser_go_back') {
        if (!history.canGoBack()) throw new ToolError('Cannot go back — no earlier history entry.')
        history.goBack()
      } else {
        if (!history.canGoForward()) {
          throw new ToolError('Cannot go forward — no later history entry.')
        }
        history.goForward()
      }
      return await navigationResult(contents)
    }

    case 'browser_open_tab': {
      const url = str(params, 'url')
      const tab = session.addTab()
      const contents = tab.view.webContents
      if (url) {
        if (!/^https?:\/\//i.test(url)) {
          throw new ToolError('URL must be absolute and start with http:// or https://')
        }
        void contents.loadURL(url).catch(() => {})
        const result = await navigationResult(contents)
        return { tabId: tab.id, ...result }
      }
      return { tabId: tab.id, url: '', title: '' }
    }

    case 'browser_switch_tab': {
      const tab = session.switchTab(requireStr(params, 'tabId'))
      const contents = tab.view.webContents
      return { tabId: tab.id, url: contents.getURL(), title: contents.getTitle() }
    }

    case 'browser_close_tab': {
      const tabId = requireStr(params, 'tabId')
      session.closeTab(tabId)
      return { closed: tabId }
    }

    case 'browser_list_tabs': {
      return { tabs: session.listTabs() }
    }

    case 'browser_wait_for': {
      const text = str(params, 'text')
      const timeoutMs = Math.min(
        num(params, 'timeoutMs') ?? DEFAULT_WAIT_FOR_TIMEOUT_MS,
        MAX_WAIT_FOR_TIMEOUT_MS
      )
      const startedAt = Date.now()
      if (!text) {
        await sleep(timeoutMs)
        return { waitedMs: timeoutMs }
      }
      const contents = session.requireTab().view.webContents
      while (Date.now() - startedAt < timeoutMs) {
        const found = await execInPage(contents, pageContainsText, [text]).catch(() => false)
        if (found) return { found: true, elapsedMs: Date.now() - startedAt }
        await sleep(300)
      }
      return {
        found: false,
        elapsedMs: Date.now() - startedAt,
        note: 'Text did not appear before the timeout. Take a browser_snapshot to see the current page state.',
      }
    }

    case 'browser_snapshot': {
      const contents = session.requireTab().view.webContents
      return await execInPage(contents, collectSnapshot, [])
    }

    case 'browser_read_text': {
      const contents = session.requireTab().view.webContents
      return unwrapPageResult(await execInPage(contents, readPageText, [num(params, 'elementId')]))
    }

    case 'browser_screenshot': {
      const contents = session.requireTab().view.webContents
      const dataUrl = await cdp.captureScreenshot(contents).catch(() => null)
      if (dataUrl === null) {
        throw new ToolError(
          'Could not capture the page. Use browser_snapshot or browser_read_text instead.'
        )
      }
      const viewport = await execInPage(contents, getViewportInfo, []).catch(() => null)
      return { dataUrl, viewport }
    }

    case 'browser_extract': {
      const instruction = requireStr(params, 'instruction')
      const contents = session.requireTab().view.webContents
      const page = await execInPage(contents, readPageText, [undefined])
      return { instruction, page }
    }

    case 'browser_click': {
      const contents = session.requireTab().view.webContents
      return unwrapPageResult(
        await execInPage(contents, clickElement, [requireNum(params, 'elementId')])
      )
    }

    case 'browser_type': {
      const elementId = requireNum(params, 'elementId')
      const text = requireStr(params, 'text')
      const submit = params.submit === true
      const contents = session.requireTab().view.webContents

      // Native path: focus + select current content, then insert through the
      // IME pipeline so the text REPLACES what's there — the only write path
      // code editors (CodeMirror/Monaco) honor. The DOM selection set by the
      // page function covers plain fields; the real select-all keystroke
      // right after covers editors that track selection in their own model
      // (their keymaps handle it synchronously, where DOM-selection sync is
      // async and can lose a race with the insert). Falls back to the
      // synthetic value-setter when CDP is unavailable.
      unwrapPageResult(await execInPage(contents, focusElementForTyping, [elementId]))
      try {
        await dispatchKeyCombo(
          contents,
          parseKeyCombo(process.platform === 'darwin' ? 'Cmd+A' : 'Control+A')
        )
        await cdp.insertText(contents, text)
      } catch {
        return unwrapPageResult(
          await execInPage(contents, typeIntoElement, [elementId, text, submit])
        )
      }
      if (submit) {
        await dispatchKeyCombo(contents, parseKeyCombo('Enter')).catch(() => {})
      }
      const state = await activeElementState(contents)
      return { typed: true, replacedExisting: true, submitted: submit, ...state }
    }

    case 'browser_press_key': {
      const combo = parseKeyCombo(requireStr(params, 'key'))
      const contents = session.requireTab().view.webContents
      try {
        await dispatchKeyCombo(contents, combo)
      } catch {
        // CDP unavailable (debugger detached): synthetic DOM fallback. It
        // cannot trigger default editing actions, so say so in the result.
        const fallback = await execInPage(contents, pressKeyOnPage, [
          combo.key,
          combo.code,
          combo.keyCode,
          combo.ctrl,
          combo.meta,
          combo.shift,
          combo.alt,
        ])
        return {
          ...(typeof fallback === 'object' && fallback !== null ? fallback : {}),
          note: 'Delivered as a synthetic page event; editing shortcuts may not take effect.',
        }
      }
      const state = await activeElementState(contents)
      return { pressed: requireStr(params, 'key'), ...state }
    }

    case 'browser_scroll': {
      const contents = session.requireTab().view.webContents
      return await execInPage(contents, scrollPage, [
        requireStr(params, 'direction'),
        num(params, 'amount'),
      ])
    }

    case 'browser_select_option': {
      const contents = session.requireTab().view.webContents
      return unwrapPageResult(
        await execInPage(contents, selectOptionInElement, [
          requireNum(params, 'elementId'),
          requireStr(params, 'value'),
        ])
      )
    }

    case 'browser_hover': {
      const contents = session.requireTab().view.webContents
      return unwrapPageResult(
        await execInPage(contents, hoverElement, [requireNum(params, 'elementId')])
      )
    }

    case 'browser_request_takeover': {
      // The reason renders in the chat's tool row, not here — but require it
      // so the model always tells the user why control was handed over.
      requireStr(params, 'reason')
      return await runTakeover()
    }

    default: {
      const exhaustive: never = tool
      throw new ToolError(`Unknown tool: ${String(exhaustive)}`)
    }
  }
}

/**
 * Attaches auto-handled page-state notices (dismissed dialogs, suppressed
 * file choosers, blocked downloads) to the outgoing result so the model
 * learns what happened without a dedicated tool.
 */
function withNotices(result: unknown): unknown {
  if (pendingNotices.length === 0) return result
  const notices = pendingNotices
  pendingNotices = []
  if (typeof result === 'object' && result !== null && !Array.isArray(result)) {
    return { ...(result as Record<string, unknown>), notices }
  }
  return { value: result, notices }
}

// ---------------------------------------------------------------------------
// Public entry points
// ---------------------------------------------------------------------------

/** One real browser can only do one thing at a time — serialize tool calls. */
let toolQueue: Promise<unknown> = Promise.resolve()

export async function executeTool(
  tool: BrowserToolName,
  params: Record<string, unknown>
): Promise<{ ok: boolean; result?: unknown; error?: string }> {
  const run = async () => {
    logger.info('Executing browser tool', { tool })
    const execution = executeToolInner(tool, params)
    const raced =
      tool === 'browser_request_takeover'
        ? execution
        : Promise.race([
            execution,
            sleep(TOOL_WATCHDOG_MS).then(() => {
              throw new ToolError(
                'The browser did not finish this action in time. Take a browser_snapshot to see the current page state.'
              )
            }),
          ])
    return withNotices(await raced)
  }

  const settled = toolQueue.then(run, run)
  toolQueue = settled.catch(() => {})
  try {
    return { ok: true, result: await settled }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    logger.warn('Browser tool failed', { tool, error: message })
    return { ok: false, error: message }
  }
}

/** Browser-chrome commands from the panel header; fire-and-forget. */
export async function handlePanelAction(action: BrowserPanelAction): Promise<void> {
  // The Done chip on the chat's takeover tool row: hands control back to the
  // agent. Meaningful only while a takeover is actually waiting.
  if (action.action === 'takeover-done') {
    if (takeoverActive) takeoverDone = true
    return
  }
  // Navigate bootstraps the session: the user can open the panel manually
  // (before the agent ever touched the browser) and drive it from the URL
  // bar. The other chrome actions need an existing page.
  if (action.action === 'navigate') {
    if (typeof action.url === 'string' && /^https?:\/\//i.test(action.url)) {
      const contents = session.ensureTab().view.webContents
      void contents.loadURL(action.url).catch(() => {})
    }
    return
  }
  const tab = session.activeTab()
  if (!tab) return
  const contents = tab.view.webContents
  switch (action.action) {
    case 'reload':
      contents.reload()
      return
    case 'back':
      if (contents.navigationHistory.canGoBack()) contents.navigationHistory.goBack()
      return
    case 'forward':
      if (contents.navigationHistory.canGoForward()) contents.navigationHistory.goForward()
      return
    default:
      return
  }
}
