/**
 * Transport for the browser agent: the agent browser built into the Sim
 * desktop app, reached through the preload bridge
 * (`window.simDesktop.browserAgent`).
 *
 * Tools execute in the Electron main process against a persistent-profile
 * browser view embedded in the main Sim window. The renderer's job is
 * geometry and chrome: it reports where the browser panel sits (the main
 * process glues the real page over that rect, so the panel is natively
 * interactive) and receives page-state pushes for the panel header.
 * Availability of this bridge is what gates advertising `browserCapable` to
 * the copilot — in a regular web browser there is no bridge and the browser
 * subagent is never offered.
 */
import type {
  BrowserPageState,
  BrowserPanelAction,
  BrowserPanelBounds,
  BrowserToolName,
} from '@sim/browser-protocol'
import type { SimDesktopBrowserAgentApi } from '@sim/desktop-bridge'
import { getDesktopBridge } from '@/lib/desktop'
import { useBrowserSessionStore } from '@/stores/browser-session/store'

let initialized = false

function bridge(): SimDesktopBrowserAgentApi | null {
  return getDesktopBridge()?.browserAgent ?? null
}

/**
 * Idempotently wires page-state and session-status pushes into the
 * browser-session store. Safe to call repeatedly (e.g. per chat mount).
 */
export function initBrowserAgentTransport(): void {
  if (initialized) return
  const agent = bridge()
  if (!agent) return
  initialized = true
  agent.onPageState((state: BrowserPageState) => {
    useBrowserSessionStore.getState().setPageState(state)
  })
  agent.onSessionStatus((alive) => {
    useBrowserSessionStore.getState().setSessionAlive(alive)
  })
}

/** True when browser tools can run (gates the copilot's browserCapable flag). */
export function isBrowserAgentAvailable(): boolean {
  return bridge() !== null
}

/**
 * Executes one browser tool in the desktop main process. Rejects on transport
 * failure, tool failure, or when `timeoutMs` elapses first (null = no
 * timeout, e.g. takeovers).
 */
export async function executeBrowserTool(
  tool: BrowserToolName,
  params: Record<string, unknown>,
  timeoutMs: number | null
): Promise<unknown> {
  const agent = bridge()
  if (!agent) {
    throw new Error('The Sim desktop browser agent is unavailable.')
  }
  const invocation = agent.executeTool(tool, params)
  const response =
    timeoutMs === null
      ? await invocation
      : await Promise.race([
          invocation,
          new Promise<never>((_, reject) => {
            setTimeout(
              () => reject(new Error(`The browser did not respond within ${timeoutMs}ms`)),
              timeoutMs
            )
          }),
        ])
  if (!response.ok) {
    throw new Error(response.error || 'The browser agent reported an error')
  }
  return response.result
}

/** Browser-chrome commands from the panel header; fire-and-forget. */
export function sendBrowserPanelAction(
  action: BrowserPanelAction['action'],
  payload: Omit<BrowserPanelAction, 'action'> = {}
): void {
  bridge()?.panelAction({ action, ...payload })
}

/**
 * Reports the panel's current rect (viewport CSS pixels), or null when the
 * panel is hidden/unmounted. The embedded view tracks this rect.
 */
export function reportBrowserPanelBounds(bounds: BrowserPanelBounds | null): void {
  bridge()?.setPanelBounds(bounds)
}
