/**
 * CDP instrumentation for agent tabs via `webContents.debugger`: auto-handles
 * the page states that would otherwise wedge automation (JS dialogs),
 * captures screenshots that work even while the view is hidden,
 * and dispatches TRUSTED input (key events, text insertion). Trusted input
 * goes through Blink's real input pipeline — unlike synthetic DOM
 * `KeyboardEvent`s, it triggers default actions (select-all, deletion, caret
 * movement, character insertion) and is honored by code editors. The user
 * sees and drives the real embedded page, so there is no screencast.
 */
import type { BrowserTheme } from '@sim/browser-protocol'
import { createLogger } from '@sim/logger'
import { sleep } from '@sim/utils/helpers'
import { nativeImage, type WebContents, type WebFrameMain } from 'electron'

const logger = createLogger('BrowserAgentCdp')

const PROTOCOL_VERSION = '1.3'
// Must settle comfortably before the driver's 20s tool watchdog. The CDP
// promise itself is not cancellable, but timing out here lets the caller send
// a release/key-up cleanup before the serialized tool queue is released.
const INPUT_COMMAND_TIMEOUT_MS = 5_000

export interface PageDialog {
  type: string
  message: string
  handled: boolean
}

export interface CdpCallbacks {
  /** A JS dialog was auto-handled; the driver surfaces it to the model. */
  onDialog: (dialog: PageDialog) => void
}

/** Per-tab callbacks, so a background tab's events reach ITS driver, not the
 * most-recently-instrumented tab's. */
const callbacksByContents = new WeakMap<WebContents, CdpCallbacks>()
/** Contents already instrumented (attach survives for the tab's lifetime). */
const instrumented = new WeakSet<WebContents>()
/** Tracks trusted input currently being dispatched by the agent itself. */
const agentInputDepthByContents = new WeakMap<WebContents, number>()
/** Flattened CDP child-target sessions keyed by their protocol frame/target id. */
const childSessionsByContents = new WeakMap<WebContents, Map<string, string>>()
const FRAME_WORLD_NAME = 'sim-browser-agent'

const AUTO_ATTACH_PARAMS = {
  autoAttach: true,
  waitForDebuggerOnStart: false,
  flatten: true,
}

async function send<T = unknown>(
  contents: WebContents,
  method: string,
  params?: Record<string, unknown>,
  sessionId?: string
): Promise<T> {
  return (await (sessionId
    ? contents.debugger.sendCommand(method, params, sessionId)
    : contents.debugger.sendCommand(method, params))) as T
}

async function sendInput(
  contents: WebContents,
  method: string,
  params: Record<string, unknown>
): Promise<void> {
  agentInputDepthByContents.set(contents, (agentInputDepthByContents.get(contents) ?? 0) + 1)
  let timer: NodeJS.Timeout | undefined
  const timeout = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(
      () => reject(new Error(`${method} did not acknowledge input within 5 seconds`)),
      INPUT_COMMAND_TIMEOUT_MS
    )
  })
  try {
    await Promise.race([send(contents, method, params), timeout])
  } finally {
    clearTimeout(timer)
    const nextDepth = (agentInputDepthByContents.get(contents) ?? 1) - 1
    if (nextDepth > 0) agentInputDepthByContents.set(contents, nextDepth)
    else agentInputDepthByContents.delete(contents)
  }
}

/** Distinguishes user input from CDP input when Electron mirrors it as an event. */
export function isDispatchingAgentInput(contents: WebContents): boolean {
  return (agentInputDepthByContents.get(contents) ?? 0) > 0
}

/** Idempotently instruments a tab's WebContents. */
export async function ensureInstrumented(contents: WebContents, cb: CdpCallbacks): Promise<void> {
  callbacksByContents.set(contents, cb)

  if (!contents.debugger.isAttached()) {
    contents.debugger.attach(PROTOCOL_VERSION)
  }
  if (!instrumented.has(contents)) {
    instrumented.add(contents)
    childSessionsByContents.set(contents, new Map())
    contents.debugger.on('message', (_event, method, params, sessionId) => {
      handleDebuggerEvent(
        contents,
        method,
        params as Record<string, unknown>,
        typeof sessionId === 'string' ? sessionId : undefined
      )
    })
  }

  // These commands are idempotent and intentionally retried. If the first
  // setup attempt loses its acknowledgement while the debugger stays
  // attached, treating the installed event listener as proof of successful
  // configuration leaves every later child-frame action permanently blind.
  await Promise.all([
    send(contents, 'Page.enable'),
    send(contents, 'Target.setAutoAttach', AUTO_ATTACH_PARAMS),
  ])
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

/** Live drag-interception state while a dragPointer call is in flight. */
interface DragInterception {
  intercepted: boolean
  data: Record<string, unknown> | null
}
const dragInterceptionsByContents = new WeakMap<WebContents, DragInterception>()

function handleDebuggerEvent(
  contents: WebContents,
  method: string,
  params: Record<string, unknown>,
  parentSessionId?: string
): void {
  if (method === 'Input.dragIntercepted') {
    const interception = dragInterceptionsByContents.get(contents)
    if (interception) {
      interception.intercepted = true
      const data = params.data
      interception.data =
        data && typeof data === 'object' ? (data as Record<string, unknown>) : null
    }
    return
  }
  if (method === 'Target.attachedToTarget') {
    const sessionId = typeof params.sessionId === 'string' ? params.sessionId : ''
    const targetInfo = params.targetInfo
    const targetId =
      targetInfo && typeof targetInfo === 'object' && 'targetId' in targetInfo
        ? String(targetInfo.targetId || '')
        : ''
    if (sessionId && targetId) {
      childSessionsByContents.get(contents)?.set(targetId, sessionId)
      // Site isolation can nest out-of-process frames. Auto-attach from the
      // child session as well so every descendant remains eligible.
      void send(contents, 'Target.setAutoAttach', AUTO_ATTACH_PARAMS, sessionId).catch(() => {})
    }
    return
  }
  if (method === 'Target.detachedFromTarget') {
    const targetId = typeof params.targetId === 'string' ? params.targetId : ''
    const detachedSession = typeof params.sessionId === 'string' ? params.sessionId : ''
    const sessions = childSessionsByContents.get(contents)
    if (targetId) sessions?.delete(targetId)
    if (detachedSession && sessions) {
      for (const [id, sessionId] of sessions) {
        if (sessionId === detachedSession) sessions.delete(id)
      }
    }
    return
  }
  const callbacks = callbacksByContents.get(contents)
  if (method === 'Page.javascriptDialogOpening') {
    const type = String(params.type ?? 'dialog')
    const message = String(params.message ?? '').slice(0, 500)
    // beforeunload is accepted (navigation proceeds); everything else is
    // dismissed — the model reacts to the recorded message instead of a
    // dialog that would block the page.
    void (async () => {
      let handled = false
      try {
        await send(
          contents,
          'Page.handleJavaScriptDialog',
          { accept: type === 'beforeunload' },
          parentSessionId
        )
        handled = true
      } catch {
        // Some Chromium builds surface an OOPIF's tab-modal dialog on its
        // flattened session but accept the dismissal only on the root target.
        if (parentSessionId) {
          try {
            await send(contents, 'Page.handleJavaScriptDialog', {
              accept: type === 'beforeunload',
            })
            handled = true
          } catch {}
        }
      }
      if (handled) logger.info('Auto-handled page dialog', { type })
      else logger.warn('Could not auto-handle page dialog', { type })
      callbacks?.onDialog({ type, message, handled })
    })()
    return
  }
}

interface ProtocolFrame {
  id: string
  parentId?: string
  name?: string
  url?: string
  securityOrigin?: string
}

interface ProtocolFrameTree {
  frame: ProtocolFrame
  childFrames?: ProtocolFrameTree[]
}

function frameMatches(candidate: ProtocolFrame, frame: WebFrameMain): boolean {
  if (candidate.url && frame.url) return candidate.url === frame.url
  if (candidate.name && frame.name) return candidate.name === frame.name
  return Boolean(
    candidate.securityOrigin &&
      frame.origin &&
      frame.origin !== 'null' &&
      candidate.securityOrigin === frame.origin
  )
}

export function sameWebFrame(left: WebFrameMain, right: WebFrameMain): boolean {
  if (left === right) return true
  if (Number.isSafeInteger(left.frameTreeNodeId) && Number.isSafeInteger(right.frameTreeNodeId)) {
    return left.frameTreeNodeId === right.frameTreeNodeId
  }
  if (
    Number.isSafeInteger(left.processId) &&
    Number.isSafeInteger(right.processId) &&
    Number.isSafeInteger(left.routingId) &&
    Number.isSafeInteger(right.routingId)
  ) {
    return left.processId === right.processId && left.routingId === right.routingId
  }
  return false
}

function locateProtocolFrame(root: ProtocolFrameTree, target: WebFrameMain): ProtocolFrame | null {
  const path: WebFrameMain[] = []
  for (let current: WebFrameMain | null = target; current?.parent; current = current.parent) {
    path.push(current)
  }
  path.reverse()

  let tree = root
  let electronParent = target.top ?? target
  // `target.top` is the main frame. For mocks/edge cases where it is absent,
  // reconstruct it by walking parents.
  while (electronParent.parent) electronParent = electronParent.parent
  for (const frame of path) {
    const children = tree.childFrames ?? []
    const siblingIndex = electronParent.frames.findIndex((candidate) =>
      sameWebFrame(candidate, frame)
    )
    const indexed = siblingIndex >= 0 ? children[siblingIndex] : undefined
    if (indexed && frameMatches(indexed.frame, frame)) {
      tree = indexed
    } else {
      const matches = children.filter((candidate) => frameMatches(candidate.frame, frame))
      if (matches.length !== 1) return null
      tree = matches[0]
    }
    electronParent = frame
  }
  return tree.frame
}

/**
 * Executes code in a persistent isolated world belonging to one child frame.
 * WebFrameMain.executeJavaScript runs in the untrusted page's main world,
 * where the page can replace the ref registry and built-ins between tools.
 */
export async function evaluateInIsolatedFrame(
  contents: WebContents,
  frame: WebFrameMain,
  expression: string,
  userGesture = false
): Promise<unknown> {
  const { frameTree } = await send<{ frameTree?: ProtocolFrameTree }>(contents, 'Page.getFrameTree')
  if (!frameTree) throw new Error('Chromium did not return a frame tree')
  const protocolFrame = locateProtocolFrame(frameTree, frame)
  if (!protocolFrame) throw new Error('Could not map the Electron frame to Chromium')

  const childSession = childSessionsByContents.get(contents)?.get(protocolFrame.id)
  const sessionCandidates = childSession ? [childSession, undefined] : [undefined]
  let contextId: number | undefined
  let selectedSession: string | undefined
  let lastError: unknown
  for (const sessionId of sessionCandidates) {
    try {
      const created = await send<{ executionContextId?: number }>(
        contents,
        'Page.createIsolatedWorld',
        {
          frameId: protocolFrame.id,
          worldName: FRAME_WORLD_NAME,
          grantUniveralAccess: false,
        },
        sessionId
      )
      if (typeof created.executionContextId !== 'number') {
        throw new Error('Chromium did not return an isolated execution context')
      }
      contextId = created.executionContextId
      selectedSession = sessionId
      break
    } catch (error) {
      lastError = error
    }
  }
  if (contextId === undefined) {
    throw lastError instanceof Error ? lastError : new Error('Could not create an isolated world')
  }

  const evaluation = await send<{
    result?: { type?: string; value?: unknown; unserializableValue?: string }
    exceptionDetails?: { text?: string; exception?: { description?: string } }
  }>(
    contents,
    'Runtime.evaluate',
    {
      expression,
      contextId,
      returnByValue: true,
      awaitPromise: true,
      userGesture,
    },
    selectedSession
  )
  if (evaluation.exceptionDetails) {
    throw new Error(
      evaluation.exceptionDetails.exception?.description ||
        evaluation.exceptionDetails.text ||
        'Frame evaluation failed'
    )
  }
  if (!evaluation.result) throw new Error('Chromium returned no frame evaluation result')
  if ('value' in evaluation.result) return evaluation.result.value
  if (evaluation.result.type === 'undefined') return undefined
  throw new Error(
    `Frame evaluation returned unsupported value ${evaluation.result.unserializableValue || evaluation.result.type || ''}`.trim()
  )
}

/**
 * Longest edge of a captured frame, in pixels. The image is sent to the model
 * as a base64 image block, so its encoded size is charged against the tool
 * result budget — an unbounded capture on a retina display is several hundred
 * kilobytes and buys no legibility the model can use.
 */
const MAX_SCREENSHOT_EDGE = 1024
const SCREENSHOT_QUALITY = 70
/**
 * Quality of the intermediate capture, before the in-process downscale
 * re-encodes at {@link SCREENSHOT_QUALITY}. Higher than the final quality so
 * the two lossy passes together land near where one pass did — the model reads
 * text out of these frames, and compression artifacts on glyphs cost more than
 * the transient bytes do.
 */
const SCREENSHOT_CAPTURE_QUALITY = 90

interface CdpViewport {
  clientWidth: number
  clientHeight: number
}

interface ScreenshotSize {
  width: number
  height: number
}

export interface ScreenshotCapture {
  dataUrl: string
  scale: number
  viewport: ScreenshotSize | null
  imageSize: ScreenshotSize | null
}

/**
 * Screenshot via CDP (works while the view is hidden), bounded in resolution.
 *
 * The capture is deliberately UNCLIPPED. Chromium implements `clip` by applying
 * device-emulation parameters (viewport offset and scale) to the widget and
 * synchronizing visual properties, then restoring them. On a headless target
 * that is invisible; against the live, composited WebContentsView the Sim
 * resource panel shows, it is a real visual-properties round-trip, and the page
 * visibly rescales and snaps back — the screenshot flash. `panel.ts`'s own
 * snapshot capture refuses to scale a visible surface for the same reason.
 *
 * Bounding resolution therefore happens here instead, on the returned image.
 * The output keeps the dimensions the clipped capture produced, so `scale`
 * still maps image pixels back to CSS pixels for the coordinate tools
 * (cssX = imageX / scale) — including on a 2x display, where an unclipped
 * capture arrives at device resolution and this is what brings it back down.
 */
export async function captureScreenshot(contents: WebContents): Promise<ScreenshotCapture> {
  const metrics = await send<{
    cssLayoutViewport?: CdpViewport
    layoutViewport?: CdpViewport
  }>(contents, 'Page.getLayoutMetrics').catch(() => null)

  const captureViewport = metrics?.cssLayoutViewport ?? metrics?.layoutViewport
  const width = captureViewport?.clientWidth ?? 0
  const height = captureViewport?.clientHeight ?? 0
  const cssWidth = metrics?.cssLayoutViewport?.clientWidth ?? 0
  const cssHeight = metrics?.cssLayoutViewport?.clientHeight ?? 0
  const cssViewport = cssWidth > 0 && cssHeight > 0 ? { width: cssWidth, height: cssHeight } : null
  const scale =
    width > 0 && height > 0 ? Math.min(1, MAX_SCREENSHOT_EDGE / Math.max(width, height)) : 1

  const result = await send<{ data: string }>(contents, 'Page.captureScreenshot', {
    format: 'jpeg',
    quality: SCREENSHOT_CAPTURE_QUALITY,
  })
  const captured = `data:image/jpeg;base64,${result.data}`

  const targetWidth = Math.round(width * scale)
  const targetHeight = Math.round(height * scale)
  const image = nativeImage.createFromBuffer(Buffer.from(result.data, 'base64'))
  const size = image.isEmpty() ? { width: 0, height: 0 } : image.getSize()
  if (size.width === 0 || size.height === 0) {
    return { dataUrl: captured, scale, viewport: cssViewport, imageSize: null }
  }
  // Without layout metrics there is no CSS frame of reference to resize
  // against, so the raw capture is the honest answer — the same fallback the
  // clipped path took. Its decoded size still lets the driver establish the
  // coordinate scale after obtaining the CSS viewport in-page.
  if (targetWidth <= 0 || targetHeight <= 0) {
    return { dataUrl: captured, scale, viewport: cssViewport, imageSize: size }
  }
  if (size.width === targetWidth && size.height === targetHeight) {
    return { dataUrl: captured, scale, viewport: cssViewport, imageSize: size }
  }

  const resized = image.resize({ width: targetWidth, height: targetHeight, quality: 'good' })
  return {
    dataUrl: `data:image/jpeg;base64,${resized.toJPEG(SCREENSHOT_QUALITY).toString('base64')}`,
    scale,
    viewport: cssViewport,
    imageSize: { width: targetWidth, height: targetHeight },
  }
}

/** One half of a trusted key press (`Input.dispatchKeyEvent` params). */
export interface CdpKeyEvent {
  type: 'keyDown' | 'rawKeyDown' | 'keyUp'
  modifiers: number
  key: string
  code: string
  windowsVirtualKeyCode: number
  text?: string
  /** Blink editing commands to run with the event (macOS shortcut parity). */
  commands?: string[]
}

/** Dispatches one trusted key event through Blink's input pipeline. */
export async function dispatchKeyEvent(contents: WebContents, event: CdpKeyEvent): Promise<void> {
  await sendInput(contents, 'Input.dispatchKeyEvent', event as unknown as Record<string, unknown>)
}

/**
 * Clicks viewport coordinates through Chromium's trusted pointer pipeline.
 * React and other delegated event systems can distinguish these events from
 * page-created MouseEvents via `isTrusted`.
 */
export async function moveMouse(contents: WebContents, x: number, y: number): Promise<void> {
  await sendInput(contents, 'Input.dispatchMouseEvent', {
    type: 'mouseMoved',
    x,
    y,
    button: 'none',
  })
}

export async function clickAt(
  contents: WebContents,
  x: number,
  y: number,
  moveBeforePress = true,
  clickCount = 1
): Promise<void> {
  if (moveBeforePress) await moveMouse(contents, x, y)
  let pressed = false
  try {
    // Set before awaiting: CDP can deliver the press and then lose/reject the
    // response (navigation/process swap). In that ambiguous case a release is
    // safer than leaving Blink's pointer state stuck down.
    pressed = true
    // A multi-click is a sequence of press/release pairs with an increasing
    // clickCount — Blink synthesizes dblclick from the pair whose count is 2.
    for (let count = 1; count <= clickCount; count++) {
      await sendInput(contents, 'Input.dispatchMouseEvent', {
        type: 'mousePressed',
        x,
        y,
        button: 'left',
        buttons: 1,
        clickCount: count,
      })
      await sendInput(contents, 'Input.dispatchMouseEvent', {
        type: 'mouseReleased',
        x,
        y,
        button: 'left',
        buttons: 0,
        clickCount: count,
      })
    }
    pressed = false
  } finally {
    if (pressed && !contents.isDestroyed()) {
      // Best-effort cleanup only. The driver deliberately does not retry a
      // synthetic click after a partial native dispatch: pointerdown handlers
      // may already have acted, and a retry can double-submit.
      await sendInput(contents, 'Input.dispatchMouseEvent', {
        type: 'mouseReleased',
        x,
        y,
        button: 'left',
        buttons: 0,
        clickCount: 1,
      }).catch(() => {})
    }
  }
}

/**
 * Drags the pointer from one viewport point to another through the trusted
 * pipeline: press, a threshold-crossing nudge, interpolated moves with the
 * button held, a settle hold over the target, then release or drop.
 *
 * Two drag models are covered by the one call. Pointer-sensor libraries
 * (dnd-kit, react-beautiful-dnd, canvas apps) treat the held-button move
 * sequence exactly like a human drag. Native HTML5 `draggable="true"`
 * sources instead START a Blink drag session on the press+move — with
 * `Input.setInterceptDrags` enabled, Chromium reports it as
 * `Input.dragIntercepted` and the remaining movement is delivered as trusted
 * `Input.dispatchDragEvent` dragEnter/dragOver events ending in a `drop`
 * (the technique Playwright uses). Both paths are trusted input.
 */
export async function dragPointer(
  contents: WebContents,
  from: { x: number; y: number },
  to: { x: number; y: number },
  steps = 12,
  stepDelayMs = 20
): Promise<{ nativeDragIntercepted: boolean }> {
  const interception: DragInterception = { intercepted: false, data: null }
  dragInterceptionsByContents.set(contents, interception)
  let interceptEnabled = false
  try {
    await send(contents, 'Input.setInterceptDrags', { enabled: true })
    interceptEnabled = true
  } catch {
    // Chromium without drag interception: the pointer-only path still works
    // for pointer-sensor drags; native HTML5 sources will report no effect.
  }
  await moveMouse(contents, from.x, from.y)
  let pressed = false
  let dragEnterSent = false
  const dragMove = async (x: number, y: number) => {
    if (interception.intercepted && interception.data) {
      await sendInput(contents, 'Input.dispatchDragEvent', {
        type: dragEnterSent ? 'dragOver' : 'dragEnter',
        x,
        y,
        data: interception.data,
      })
      dragEnterSent = true
    } else {
      await sendInput(contents, 'Input.dispatchMouseEvent', {
        type: 'mouseMoved',
        x,
        y,
        button: 'left',
        buttons: 1,
      })
    }
  }
  try {
    pressed = true
    await sendInput(contents, 'Input.dispatchMouseEvent', {
      type: 'mousePressed',
      x: from.x,
      y: from.y,
      button: 'left',
      buttons: 1,
      clickCount: 1,
    })
    // Small first nudge so libraries with a start threshold (commonly 3-8px)
    // register the drag before the pointer sweeps across the page.
    await dragMove(from.x + Math.sign(to.x - from.x || 1) * 4, from.y + 2)
    await sleep(stepDelayMs)
    const stepCount = Math.max(2, steps)
    for (let step = 1; step <= stepCount; step++) {
      const progress = step / stepCount
      await dragMove(from.x + (to.x - from.x) * progress, from.y + (to.y - from.y) * progress)
      await sleep(stepDelayMs)
    }
    // Hold over the target so drop zones running enter/over animations settle
    // before the release lands.
    await sleep(120)
    if (interception.intercepted && interception.data) {
      await sendInput(contents, 'Input.dispatchDragEvent', {
        type: 'drop',
        x: to.x,
        y: to.y,
        data: interception.data,
      })
      // Blink ended the intercepted drag session itself; a trailing
      // mouseReleased would be a stray click on the drop target.
      pressed = false
    } else {
      await sendInput(contents, 'Input.dispatchMouseEvent', {
        type: 'mouseReleased',
        x: to.x,
        y: to.y,
        button: 'left',
        buttons: 0,
        clickCount: 1,
      })
      pressed = false
    }
    return { nativeDragIntercepted: interception.intercepted }
  } finally {
    if (pressed && !contents.isDestroyed()) {
      if (interception.intercepted && interception.data) {
        await sendInput(contents, 'Input.dispatchDragEvent', {
          type: 'dragCancel',
          x: to.x,
          y: to.y,
          data: interception.data,
        }).catch(() => {})
      } else {
        await sendInput(contents, 'Input.dispatchMouseEvent', {
          type: 'mouseReleased',
          x: to.x,
          y: to.y,
          button: 'left',
          buttons: 0,
          clickCount: 1,
        }).catch(() => {})
      }
    }
    dragInterceptionsByContents.delete(contents)
    if (interceptEnabled && !contents.isDestroyed()) {
      await send(contents, 'Input.setInterceptDrags', { enabled: false }).catch(() => {})
    }
  }
}

/**
 * Inserts text at the focused element's selection (replacing it) through the
 * native IME path — works in plain fields and code editors alike.
 */
export async function insertText(contents: WebContents, text: string): Promise<void> {
  await sendInput(contents, 'Input.insertText', { text })
}
