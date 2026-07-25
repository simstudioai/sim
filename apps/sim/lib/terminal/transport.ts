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

  terminal.onTabs((tabs) => {
    useCopilotTerminalStore.getState().setTabs(tabs)
  })
  terminal.onCommand((event) => {
    useCopilotTerminalStore.getState().applyCommandEvent(event)
  })
  void terminal
    .getTabs()
    .then((tabs) => useCopilotTerminalStore.getState().setTabs(tabs))
    .catch(() => {})
}

/** Subscribes to raw PTY output for every terminal. */
export function onTerminalData(callback: (terminalId: string, data: string) => void): () => void {
  return bridge()?.onData(callback) ?? (() => {})
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
