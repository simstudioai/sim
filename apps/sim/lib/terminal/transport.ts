/**
 * Transport for the agent terminals: real PTYs in the Sim desktop app, reached
 * through the preload bridge (`window.simDesktop.terminal`).
 *
 * The shell processes live in the Electron main process; the renderer paints
 * their bytes with xterm.js and forwards keystrokes back, so the user and the
 * agent share the same terminals. Availability of this bridge, plus the device
 * switch on the Terminal settings page, is what gates advertising
 * `terminalCapable` to the copilot — in a regular web browser there is no
 * bridge and the terminal tools are never offered.
 */
import type { SimDesktopTerminalApi } from '@sim/desktop-bridge'
import type {
  TerminalOperation,
  TerminalStartOptions,
  TerminalTabsState,
  TerminalToolArgs,
} from '@sim/terminal-protocol'
import { getDesktopBridge, isTerminalEnabled } from '@/lib/desktop'
import { LEGACY_TERMINAL_SCOPE, useCopilotTerminalStore } from '@/stores/copilot-terminal/store'

let initialized = false
let activeScopeId = LEGACY_TERMINAL_SCOPE

function bridge(): SimDesktopTerminalApi | null {
  return getDesktopBridge()?.terminal ?? null
}

/** Applies the renderer half of a native suspension, regardless of its initiator. */
function applyTerminalScopeSuspended(scopeId: string): void {
  useCopilotTerminalStore.getState().suspendScope(scopeId)
  if (activeScopeId === scopeId) activeScopeId = LEGACY_TERMINAL_SCOPE
}

/** True when terminal tools can run (gates the copilot's terminalCapable flag). */
export function isTerminalAvailable(): boolean {
  return isTerminalEnabled()
}

/**
 * Idempotently wires tab and command pushes into the store. Output is
 * deliberately not routed here: each xterm subscribes to it directly so bytes
 * never pass through React state.
 */
export function initTerminalTransport(): void {
  if (initialized) return
  const terminal = bridge()
  if (!terminal) return
  initialized = true

  // Every surface below is optional-called. The same web app is served to
  // shells of any age, and these arrived after the terminal first shipped: a
  // bare call on an older shell threw a TypeError out of the mount effect that
  // invokes this, taking the whole chat view to the error boundary instead of
  // degrading to "no terminal".
  terminal.onTabs?.((tabs) => {
    useCopilotTerminalStore.getState().setTabs(tabs, tabs.scopeId ?? activeScopeId)
  })
  terminal.onCommand?.((event) => {
    useCopilotTerminalStore.getState().applyCommandEvent(event, event.scopeId ?? activeScopeId)
  })
  terminal.onScopeSuspended?.(applyTerminalScopeSuspended)
  const initialScopeId = activeScopeId
  void terminal
    .getTabs?.(initialScopeId)
    ?.then((tabs) => useCopilotTerminalStore.getState().setTabs(tabs, initialScopeId))
    .catch(() => {})
}

/** Makes one chat's terminal group active in both renderer and desktop. */
export async function activateTerminalScope(scopeId: string): Promise<void> {
  activeScopeId = scopeId
  useCopilotTerminalStore.getState().activateScope(scopeId)
  const terminal = bridge()
  if (!terminal) return
  const tabs = terminal.activateScope
    ? await terminal.activateScope(scopeId)
    : await terminal.getTabs?.(scopeId)
  if (tabs) {
    useCopilotTerminalStore.getState().setTabs(tabs, scopeId)
  }
}

/** Rebinds a pending new-chat terminal group to the chat id assigned by the server. */
export async function migrateTerminalScope(fromScopeId: string, toScopeId: string): Promise<void> {
  const tabs = await bridge()?.migrateScope?.(fromScopeId, toScopeId)
  if (tabs?.scopeId !== toScopeId) {
    // Keep renderer ownership aligned with main: if an existing durable
    // destination wins, discard the provisional shells instead of retagging
    // stale terminal ids that main refused to move.
    await discardTerminalScope(fromScopeId)
    return
  }

  useCopilotTerminalStore.getState().migrateScope(fromScopeId, toScopeId)
  if (activeScopeId === fromScopeId) activeScopeId = toScopeId
  useCopilotTerminalStore.getState().setTabs(tabs, toScopeId)
}

/** Ends and forgets an abandoned pre-chat terminal group. */
export async function discardTerminalScope(scopeId: string): Promise<void> {
  if (!scopeId.startsWith('pending:')) return
  useCopilotTerminalStore.getState().discardScope(scopeId)
  if (activeScopeId === scopeId) activeScopeId = LEGACY_TERMINAL_SCOPE
  await bridge()?.disposeScope?.(scopeId)
}

/** Stops a soft-deleted chat's PTYs while retaining its encrypted descriptor. */
export async function suspendTerminalScope(scopeId: string): Promise<boolean> {
  if (scopeId === LEGACY_TERMINAL_SCOPE || scopeId.startsWith('pending:')) return false
  const suspended = (await bridge()?.suspendScope?.(scopeId)) ?? false
  if (!suspended) return false

  applyTerminalScopeSuspended(scopeId)
  return true
}

/**
 * One bridge subscription for all terminals, fanned out by id.
 *
 * Every mounted terminal view wants only its own bytes, but each PTY message
 * crosses the context bridge once per registered listener — so a listener per
 * view made a single terminal's output cost O(open tabs) crossings a message,
 * most of them discarded by an id check. This keeps exactly one bridge
 * listener and routes each message to the view that asked for that id.
 */
const dataHandlers = new Map<string, (data: string) => void>()
let dataBridgeUnsubscribe: (() => void) | null = null

function dataHandlerKey(scopeId: string, terminalId: string): string {
  return `${scopeId}\u0000${terminalId}`
}

function ensureDataBridge(): void {
  if (dataBridgeUnsubscribe) return
  // Only latch once a real subscription exists. Caching a no-op because the
  // bridge happened to be absent on the first call left every terminal in the
  // session with no output and no way to recover.
  const unsubscribe = bridge()?.onData?.((id, data, scopeId) =>
    dataHandlers.get(dataHandlerKey(scopeId ?? activeScopeId, id))?.(data)
  )
  if (unsubscribe) dataBridgeUnsubscribe = unsubscribe
}

/** Subscribes to raw PTY output for one terminal. */
export function onTerminalData(
  terminalId: string,
  callback: (data: string) => void,
  scopeId = activeScopeId
): () => void {
  ensureDataBridge()
  const key = dataHandlerKey(scopeId, terminalId)
  dataHandlers.set(key, callback)
  return () => {
    if (dataHandlers.get(key) === callback) dataHandlers.delete(key)
  }
}

/**
 * Everything already on a terminal's screen, for a new view to paint itself
 * from. Empty when the desktop bridge is unavailable, which leaves the view
 * blank rather than failing the mount.
 */
/**
 * Tells the desktop app whether a terminal owns keyboard focus. Menu
 * accelerators are global, so Cmd-W has to know whether the user is typing in
 * a shell before it decides what to close.
 */
export function reportTerminalFocused(focused: boolean, scopeId = activeScopeId): void {
  bridge()?.setFocused?.(focused, scopeId)
}

/** Tells a waiting handoff that the user is done in the terminal. */
export function finishTerminalHandoff(terminalId: string, scopeId = activeScopeId): void {
  bridge()?.finishHandoff?.(terminalId, scopeId)
}

export async function getTerminalScrollback(
  terminalId: string,
  scopeId = activeScopeId
): Promise<string> {
  return (await bridge()?.getScrollback(terminalId, scopeId)) ?? ''
}

export async function startTerminalSession(
  options: TerminalStartOptions,
  scopeId = activeScopeId
): Promise<TerminalTabsState> {
  const terminal = bridge()
  if (!terminal) {
    throw new Error('The Sim desktop terminal is unavailable.')
  }
  return terminal.start(options, scopeId)
}

export function writeToTerminal(terminalId: string, data: string, scopeId = activeScopeId): void {
  bridge()?.write(terminalId, data, scopeId)
}

/**
 * Pastes the system clipboard into a terminal, reading it in the main process
 * when the shell can.
 *
 * Returns false when this shell predates `paste`, so the caller can fall back to
 * reading the clipboard itself. Main-side is preferred for two reasons: the read
 * is synchronous there, so there is no window in which the paste can be refused
 * for want of a recent gesture, and the renderer never touches the clipboard —
 * which is the direction Electron itself took when it removed the `clipboard`
 * module from renderers.
 */
export async function pasteIntoTerminal(
  terminalId: string,
  scopeId = activeScopeId
): Promise<boolean> {
  const paste = bridge()?.paste
  if (!paste) return false
  return paste(terminalId, scopeId)
}

export function resizeTerminal(
  terminalId: string,
  cols: number,
  rows: number,
  scopeId = activeScopeId
): void {
  bridge()?.resize(terminalId, cols, rows, scopeId)
}

export async function openTerminal(cwd?: string, scopeId = activeScopeId): Promise<void> {
  await bridge()?.openTerminal(cwd, scopeId)
}

export async function switchTerminal(terminalId: string, scopeId = activeScopeId): Promise<void> {
  await bridge()?.switchTerminal(terminalId, scopeId)
}

export async function closeTerminal(terminalId: string, scopeId = activeScopeId): Promise<void> {
  await bridge()?.closeTerminal(terminalId, scopeId)
}

/** Executes one terminal operation in the desktop main process. */
export async function executeTerminalTool(
  toolCallId: string,
  operation: TerminalOperation,
  args: TerminalToolArgs,
  scopeId = activeScopeId
): Promise<unknown> {
  const terminal = bridge()
  if (!terminal) {
    throw new Error('The Sim desktop terminal is unavailable.')
  }
  const response = await terminal.executeTool(toolCallId, operation, args, scopeId)
  if (!response.ok) {
    const error = new Error(response.error || 'The terminal reported an error')
    if (response.code) error.name = response.code
    throw error
  }
  return response.result
}
