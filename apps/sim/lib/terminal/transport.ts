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
import { useCopilotTerminalStore } from '@/stores/copilot-terminal/store'

let initialized = false

function bridge(): SimDesktopTerminalApi | null {
  return getDesktopBridge()?.terminal ?? null
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
    useCopilotTerminalStore.getState().setTabs(tabs)
  })
  terminal.onCommand?.((event) => {
    useCopilotTerminalStore.getState().applyCommandEvent(event)
  })
  void terminal
    .getTabs?.()
    ?.then((tabs) => useCopilotTerminalStore.getState().setTabs(tabs))
    .catch(() => {})
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

function ensureDataBridge(): void {
  if (dataBridgeUnsubscribe) return
  // Only latch once a real subscription exists. Caching a no-op because the
  // bridge happened to be absent on the first call left every terminal in the
  // session with no output and no way to recover.
  const unsubscribe = bridge()?.onData?.((id, data) => dataHandlers.get(id)?.(data))
  if (unsubscribe) dataBridgeUnsubscribe = unsubscribe
}

/** Subscribes to raw PTY output for one terminal. */
export function onTerminalData(terminalId: string, callback: (data: string) => void): () => void {
  ensureDataBridge()
  dataHandlers.set(terminalId, callback)
  return () => {
    if (dataHandlers.get(terminalId) === callback) dataHandlers.delete(terminalId)
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
export function reportTerminalFocused(focused: boolean): void {
  bridge()?.setFocused?.(focused)
}

/** Tells a waiting handoff that the user is done in the terminal. */
export function finishTerminalHandoff(terminalId: string): void {
  bridge()?.finishHandoff?.(terminalId)
}

export async function getTerminalScrollback(terminalId: string): Promise<string> {
  return (await bridge()?.getScrollback(terminalId)) ?? ''
}

export async function startTerminalSession(
  options: TerminalStartOptions
): Promise<TerminalTabsState> {
  const terminal = bridge()
  if (!terminal) {
    throw new Error('The Sim desktop terminal is unavailable.')
  }
  return terminal.start(options)
}

export function writeToTerminal(terminalId: string, data: string): void {
  bridge()?.write(terminalId, data)
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
export async function pasteIntoTerminal(terminalId: string): Promise<boolean> {
  const paste = bridge()?.paste
  if (!paste) return false
  return paste(terminalId)
}

export function resizeTerminal(terminalId: string, cols: number, rows: number): void {
  bridge()?.resize(terminalId, cols, rows)
}

export async function openTerminal(cwd?: string): Promise<void> {
  await bridge()?.openTerminal(cwd)
}

export async function switchTerminal(terminalId: string): Promise<void> {
  await bridge()?.switchTerminal(terminalId)
}

export async function closeTerminal(terminalId: string): Promise<void> {
  await bridge()?.closeTerminal(terminalId)
}

/** Executes one terminal operation in the desktop main process. */
export async function executeTerminalTool(
  toolCallId: string,
  operation: TerminalOperation,
  args: TerminalToolArgs
): Promise<unknown> {
  const terminal = bridge()
  if (!terminal) {
    throw new Error('The Sim desktop terminal is unavailable.')
  }
  const response = await terminal.executeTool(toolCallId, operation, args)
  if (!response.ok) {
    const error = new Error(response.error || 'The terminal reported an error')
    if (response.code) error.name = response.code
    throw error
  }
  return response.result
}
