/**
 * Transport for the agent terminal: a real PTY in the Sim desktop app, reached
 * through the preload bridge (`window.simDesktop.terminal`).
 *
 * The shell process lives in the Electron main process; the renderer paints its
 * bytes with xterm.js and forwards keystrokes back, so the user and the agent
 * share one session. Availability of this bridge is what gates advertising
 * `terminalCapable` to the copilot — in a regular web browser there is no
 * bridge and the terminal tools are never offered.
 */
import type { SimDesktopTerminalApi } from '@sim/desktop-bridge'
import type {
  TerminalSessionState,
  TerminalStartOptions,
  TerminalToolName,
} from '@sim/terminal-protocol'
import { getDesktopBridge } from '@/lib/desktop'
import { useCopilotTerminalStore } from '@/stores/copilot-terminal/store'

let initialized = false

function bridge(): SimDesktopTerminalApi | null {
  return getDesktopBridge()?.terminal ?? null
}

/** True when terminal tools can run (gates the copilot's terminalCapable flag). */
export function isTerminalAvailable(): boolean {
  return bridge() !== null
}

/**
 * Idempotently wires session-state and command pushes into the store. Output is deliberately not routed here: xterm.js subscribes to it
 * directly so bytes never pass through React state.
 */
export function initTerminalTransport(): void {
  if (initialized) return
  const terminal = bridge()
  if (!terminal) return
  initialized = true

  terminal.onState((state) => {
    useCopilotTerminalStore.getState().setSessionState(state)
  })
  terminal.onCommand((event) => {
    useCopilotTerminalStore.getState().applyCommandEvent(event)
  })
  void terminal
    .getState()
    .then((state) => useCopilotTerminalStore.getState().setSessionState(state))
    .catch(() => {})
}

/** Subscribes to raw PTY output. Returns an unsubscribe function. */
export function onTerminalData(callback: (data: string) => void): () => void {
  return bridge()?.onData(callback) ?? (() => {})
}

/**
 * Subscribes to full-scrollback repaints, sent when attaching to a shell that
 * was already running. The panel clears before writing.
 */
export function onTerminalReplay(callback: (data: string) => void): () => void {
  return bridge()?.onReplay?.(callback) ?? (() => {})
}

export async function startTerminalSession(
  options: TerminalStartOptions
): Promise<TerminalSessionState> {
  const terminal = bridge()
  if (!terminal) {
    throw new Error('The Sim desktop terminal is unavailable.')
  }
  return terminal.start(options)
}

export function writeToTerminal(data: string): void {
  bridge()?.write(data)
}

export function resizeTerminal(cols: number, rows: number): void {
  bridge()?.resize(cols, rows)
}

export function disposeTerminalSession(): void {
  bridge()?.dispose()
}

/** Executes one terminal tool in the desktop main process. */
export async function executeTerminalTool(
  toolCallId: string,
  tool: TerminalToolName,
  params: Record<string, unknown>
): Promise<unknown> {
  const terminal = bridge()
  if (!terminal) {
    throw new Error('The Sim desktop terminal is unavailable.')
  }
  const response = await terminal.executeTool(toolCallId, tool, params)
  if (!response.ok) {
    const error = new Error(response.error || 'The terminal reported an error')
    if (response.code) error.name = response.code
    throw error
  }
  return response.result
}
