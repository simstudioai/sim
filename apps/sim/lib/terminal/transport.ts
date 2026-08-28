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
import {
  type DesktopZoomPercent,
  isPendingDesktopScopeId,
  type SimDesktopTerminalApi,
  type TerminalPasteResult,
  type TerminalShortcutCommand,
} from '@sim/desktop-bridge'
import type {
  ScopedTerminalTabsState,
  TerminalOperation,
  TerminalStartOptions,
  TerminalToolArgs,
} from '@sim/terminal-protocol'
import { getDesktopBridge, isTerminalEnabled } from '@/lib/desktop'
import { useCopilotTerminalStore } from '@/stores/copilot-terminal/store'

let initialized = false
let activeScopeId: string | null = null

function bridge(): SimDesktopTerminalApi | null {
  return getDesktopBridge()?.terminal ?? null
}

function currentTerminalScopeId(): string {
  if (!activeScopeId) throw new Error('No terminal chat scope is active.')
  return activeScopeId
}

/** Applies the renderer half of a native suspension, regardless of its initiator. */
function applyTerminalScopeSuspended(scopeId: string): void {
  useCopilotTerminalStore.getState().suspendScope(scopeId)
  if (activeScopeId === scopeId) activeScopeId = null
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

  terminal.onTabs((tabs) => {
    useCopilotTerminalStore.getState().setTabs(tabs)
  })
  terminal.onCommand((event) => {
    useCopilotTerminalStore.getState().applyCommandEvent(event)
  })
  terminal.onScopeSuspended(applyTerminalScopeSuspended)
}

/** Makes one chat's terminal group active in both renderer and desktop. */
export async function activateTerminalScope(scopeId: string): Promise<void> {
  activeScopeId = scopeId
  useCopilotTerminalStore.getState().activateScope(scopeId)
  const terminal = bridge()
  if (!terminal) return
  const tabs = await terminal.activateScope(scopeId)
  useCopilotTerminalStore.getState().setTabs(tabs)
}

/** Rebinds a pending new-chat terminal group to the chat id assigned by the server. */
export async function migrateTerminalScope(fromScopeId: string, toScopeId: string): Promise<void> {
  const tabs = await bridge()?.migrateScope(fromScopeId, toScopeId)
  if (tabs?.scopeId !== toScopeId) {
    // Keep renderer ownership aligned with main: if an existing durable
    // destination wins, discard the provisional shells instead of retagging
    // stale terminal ids that main refused to move.
    await discardTerminalScope(fromScopeId)
    return
  }

  useCopilotTerminalStore.getState().migrateScope(fromScopeId, toScopeId)
  if (activeScopeId === fromScopeId) activeScopeId = toScopeId
  useCopilotTerminalStore.getState().setTabs(tabs)
}

/** Ends and forgets an abandoned pre-chat terminal group. */
export async function discardTerminalScope(scopeId: string): Promise<void> {
  if (!isPendingDesktopScopeId(scopeId)) return
  useCopilotTerminalStore.getState().discardScope(scopeId)
  if (activeScopeId === scopeId) activeScopeId = null
  await bridge()?.disposeScope(scopeId)
}

/** Stops a soft-deleted chat's PTYs while retaining its encrypted descriptor. */
export async function suspendTerminalScope(scopeId: string): Promise<boolean> {
  if (isPendingDesktopScopeId(scopeId)) return false
  const suspended = (await bridge()?.suspendScope(scopeId)) ?? false
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
  const unsubscribe = bridge()?.onData((id, data, scopeId) =>
    dataHandlers.get(dataHandlerKey(scopeId, id))?.(data)
  )
  if (unsubscribe) dataBridgeUnsubscribe = unsubscribe
}

/** Subscribes to raw PTY output for one terminal. */
export function onTerminalData(
  terminalId: string,
  callback: (data: string) => void,
  scopeId = currentTerminalScopeId()
): () => void {
  ensureDataBridge()
  const key = dataHandlerKey(scopeId, terminalId)
  dataHandlers.set(key, callback)
  return () => {
    if (dataHandlers.get(key) === callback) dataHandlers.delete(key)
  }
}

/**
 * Tells the desktop app whether the visible terminal resource owns shortcut
 * routing. Menu accelerators are global, so this claim must survive transient
 * focus moves through the panel chrome.
 */
export function reportTerminalFocused(focused: boolean, scopeId = currentTerminalScopeId()): void {
  bridge()?.setFocused(focused, scopeId)
}

/** Tells the shell which terminal panel is visibly open for tab shortcuts. */
export function reportTerminalVisible(visible: boolean, scopeId = currentTerminalScopeId()): void {
  bridge()?.setVisible?.(visible, scopeId)
}

/** Subscribes to menu shortcuts routed to one focused terminal scope. */
export function onTerminalShortcutCommand(
  callback: (command: TerminalShortcutCommand) => void,
  scopeId = currentTerminalScopeId(),
  terminalId?: string
): () => void {
  return (
    bridge()?.onShortcutCommand((command, eventScopeId, eventTerminalId) => {
      if (eventScopeId !== scopeId) return
      if (eventTerminalId !== undefined && eventTerminalId !== terminalId) return
      callback(command)
    }) ?? (() => {})
  )
}

/** Subscribes to device-wide terminal default-zoom changes. */
export function onTerminalDefaultZoomChanged(
  callback: (zoom: DesktopZoomPercent) => void
): () => void {
  return bridge()?.onDefaultZoomChanged(callback) ?? (() => {})
}

/** Tells a waiting handoff that the user is done in the terminal. */
export function finishTerminalHandoff(
  terminalId: string,
  scopeId = currentTerminalScopeId()
): void {
  bridge()?.finishHandoff(terminalId, scopeId)
}

export async function getTerminalScrollback(
  terminalId: string,
  scopeId = currentTerminalScopeId()
): Promise<string> {
  return (await bridge()?.getScrollback(terminalId, scopeId)) ?? ''
}

/** Forgets the desktop-owned replay buffer after the local xterm is cleared. */
export async function clearTerminalScrollback(
  terminalId: string,
  scopeId = currentTerminalScopeId()
): Promise<boolean> {
  return (await bridge()?.clearScrollback(terminalId, scopeId)) ?? false
}

export async function startTerminalSession(
  options: TerminalStartOptions,
  scopeId = currentTerminalScopeId()
): Promise<ScopedTerminalTabsState> {
  const terminal = bridge()
  if (!terminal) {
    throw new Error('The Sim desktop terminal is unavailable.')
  }
  return terminal.start(options, scopeId)
}

export function writeToTerminal(
  terminalId: string,
  data: string,
  scopeId = currentTerminalScopeId()
): void {
  bridge()?.write(terminalId, data, scopeId)
}

/**
 * Pastes the system clipboard into a terminal, reading it in the main process
 * when the shell can.
 *
 * Main-side is preferred because the read is synchronous, so there is no
 * window in which the paste can be refused for want of a recent gesture, and
 * the renderer never touches the clipboard.
 */
export async function pasteIntoTerminal(
  terminalId: string,
  scopeId = currentTerminalScopeId()
): Promise<TerminalPasteResult> {
  return (await bridge()?.paste(terminalId, scopeId)) ?? false
}

export function resizeTerminal(
  terminalId: string,
  cols: number,
  rows: number,
  scopeId = currentTerminalScopeId()
): void {
  bridge()?.resize(terminalId, cols, rows, scopeId)
}

export async function openTerminal(
  cwd?: string,
  scopeId = currentTerminalScopeId()
): Promise<ScopedTerminalTabsState> {
  const terminal = bridge()
  if (!terminal) throw new Error('The Sim desktop terminal is unavailable.')
  return terminal.openTerminal(cwd, scopeId)
}

export async function switchTerminal(
  terminalId: string,
  scopeId = currentTerminalScopeId()
): Promise<void> {
  await bridge()?.switchTerminal(terminalId, scopeId)
}

/** Moves a terminal tab when the installed shell supports ordering. */
export async function reorderTerminal(
  terminalId: string,
  targetIndex: number,
  scopeId = currentTerminalScopeId()
): Promise<void> {
  await bridge()?.reorderTerminal?.(terminalId, targetIndex, scopeId)
}

export async function closeTerminal(
  terminalId: string,
  scopeId = currentTerminalScopeId()
): Promise<void> {
  await bridge()?.closeTerminal(terminalId, scopeId)
}

/** Executes one terminal operation in the desktop main process. */
export async function executeTerminalTool(
  toolCallId: string,
  operation: TerminalOperation,
  args: TerminalToolArgs,
  scopeId = currentTerminalScopeId()
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
