/**
 * CDP instrumentation for agent tabs via `webContents.debugger`: auto-handles
 * the page states that would otherwise wedge automation (JS dialogs, file
 * choosers), captures screenshots that work even while the view is hidden,
 * and dispatches TRUSTED input (key events, text insertion). Trusted input
 * goes through Blink's real input pipeline — unlike synthetic DOM
 * `KeyboardEvent`s, it triggers default actions (select-all, deletion, caret
 * movement, character insertion) and is honored by code editors. The user
 * sees and drives the real embedded page, so there is no screencast.
 */
import type { BrowserTheme } from '@sim/browser-protocol'
import { createLogger } from '@sim/logger'
import type { WebContents } from 'electron'

const logger = createLogger('BrowserAgentCdp')

const PROTOCOL_VERSION = '1.3'

export interface PageDialog {
  type: string
  message: string
}

export interface CdpCallbacks {
  /** A JS dialog was auto-handled; the driver surfaces it to the model. */
  onDialog: (dialog: PageDialog) => void
  /** A file chooser was suppressed; the driver surfaces it to the model. */
  onFileChooser: () => void
}

/** Per-tab callbacks, so a background tab's events reach ITS driver, not the
 * most-recently-instrumented tab's. */
const callbacksByContents = new WeakMap<WebContents, CdpCallbacks>()
/** Contents already instrumented (attach survives for the tab's lifetime). */
const instrumented = new WeakSet<WebContents>()

async function send<T = unknown>(
  contents: WebContents,
  method: string,
  params?: Record<string, unknown>
): Promise<T> {
  return (await contents.debugger.sendCommand(method, params)) as T
}

/** Idempotently instruments a tab's WebContents. */
export async function ensureInstrumented(contents: WebContents, cb: CdpCallbacks): Promise<void> {
  callbacksByContents.set(contents, cb)
  if (instrumented.has(contents) && contents.debugger.isAttached()) return

  if (!contents.debugger.isAttached()) {
    contents.debugger.attach(PROTOCOL_VERSION)
  }
  if (!instrumented.has(contents)) {
    instrumented.add(contents)
    contents.debugger.on('message', (_event, method, params) => {
      handleDebuggerEvent(contents, method, params as Record<string, unknown>)
    })
  }

  await send(contents, 'Page.enable')
  // Suppress native file choosers: nothing can drive them from the panel,
  // and an open chooser blocks the page. Recorded and surfaced instead.
  await send(contents, 'Page.setInterceptFileChooserDialog', { enabled: true }).catch(() => {})
}

/**
 * Mirrors Sim's theme into the page's `prefers-color-scheme` media query.
 * `system` removes the per-tab override so Chromium continues following the OS.
 */
export async function setColorScheme(contents: WebContents, theme: BrowserTheme): Promise<void> {
  await send(contents, 'Emulation.setEmulatedMedia', {
    features: theme === 'system' ? [] : [{ name: 'prefers-color-scheme', value: theme }],
  })
}

function handleDebuggerEvent(
  contents: WebContents,
  method: string,
  params: Record<string, unknown>
): void {
  const callbacks = callbacksByContents.get(contents)
  if (method === 'Page.javascriptDialogOpening') {
    const type = String(params.type ?? 'dialog')
    const message = String(params.message ?? '').slice(0, 500)
    // beforeunload is accepted (navigation proceeds); everything else is
    // dismissed — the model reacts to the recorded message instead of a
    // dialog that would block the page.
    void send(contents, 'Page.handleJavaScriptDialog', {
      accept: type === 'beforeunload',
    }).catch(() => {})
    logger.info('Auto-handled page dialog', { type })
    callbacks?.onDialog({ type, message })
    return
  }
  if (method === 'Page.fileChooserOpened') {
    logger.info('Suppressed file chooser in agent browser')
    callbacks?.onFileChooser()
  }
}

/**
 * Longest edge of a captured frame, in pixels. The image is sent to the model
 * as a base64 image block, so its encoded size is charged against the tool
 * result budget — an unbounded capture on a retina display is several hundred
 * kilobytes and buys no legibility the model can use.
 */
const MAX_SCREENSHOT_EDGE = 1024
const SCREENSHOT_QUALITY = 70

interface CdpViewport {
  clientWidth: number
  clientHeight: number
}

/**
 * Screenshot via CDP (works while the view is hidden), bounded in resolution.
 *
 * `clip.scale` is relative to CSS pixels, so passing the CSS viewport with a
 * scale of 1 already sidesteps the device pixel ratio — an unclipped capture
 * on a 2x display returns a 2x image. Scaling further down keeps the longest
 * edge within {@link MAX_SCREENSHOT_EDGE}. Falls back to an unclipped capture
 * when layout metrics are unavailable.
 */
export async function captureScreenshot(contents: WebContents): Promise<string> {
  const metrics = await send<{
    cssLayoutViewport?: CdpViewport
    layoutViewport?: CdpViewport
  }>(contents, 'Page.getLayoutMetrics').catch(() => null)

  const viewport = metrics?.cssLayoutViewport ?? metrics?.layoutViewport
  const width = viewport?.clientWidth ?? 0
  const height = viewport?.clientHeight ?? 0
  const clip =
    width > 0 && height > 0
      ? {
          x: 0,
          y: 0,
          width,
          height,
          scale: Math.min(1, MAX_SCREENSHOT_EDGE / Math.max(width, height)),
        }
      : undefined

  const result = await send<{ data: string }>(contents, 'Page.captureScreenshot', {
    format: 'jpeg',
    quality: SCREENSHOT_QUALITY,
    ...(clip ? { clip } : {}),
  })
  return `data:image/jpeg;base64,${result.data}`
}

/** One half of a trusted key press (`Input.dispatchKeyEvent` params). */
export interface CdpKeyEvent {
  type: 'keyDown' | 'rawKeyDown' | 'keyUp'
  modifiers: number
  key: string
  code: string
  windowsVirtualKeyCode: number
  nativeVirtualKeyCode: number
  text?: string
  /** Blink editing commands to run with the event (macOS shortcut parity). */
  commands?: string[]
}

/** Dispatches one trusted key event through Blink's input pipeline. */
export async function dispatchKeyEvent(contents: WebContents, event: CdpKeyEvent): Promise<void> {
  await send(contents, 'Input.dispatchKeyEvent', event as unknown as Record<string, unknown>)
}

/**
 * Inserts text at the focused element's selection (replacing it) through the
 * native IME path — works in plain fields and code editors alike.
 */
export async function insertText(contents: WebContents, text: string): Promise<void> {
  await send(contents, 'Input.insertText', { text })
}
