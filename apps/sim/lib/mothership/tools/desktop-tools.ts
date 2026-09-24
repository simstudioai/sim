import {
  CURRENT_BROWSER_TOOL_NAMES,
  isBrowserToolName,
  isCurrentBrowserToolName,
} from '@sim/browser-protocol'
import { isTerminalToolName, TERMINAL_TOOL_NAME } from '@sim/terminal-protocol'
import { DESKTOP_TOOL_CLAIM_OWNER } from '@/lib/mothership/async-runs/lifecycle'
import { isUserLocalVfsToolCall } from '@/lib/mothership/tools/local-filesystem'

/**
 * The one place that answers "is this a desktop tool": the calls that act on the user's machine
 * through the Sim desktop app rather than on Sim's servers.
 */

export type DesktopToolClaimOwner =
  (typeof DESKTOP_TOOL_CLAIM_OWNER)[keyof typeof DESKTOP_TOOL_CLAIM_OWNER]

/** The tools that run through the desktop app by name alone; local VFS reads also depend on args. */
export const NAMED_DESKTOP_TOOL_NAMES = [
  ...CURRENT_BROWSER_TOOL_NAMES,
  TERMINAL_TOOL_NAME,
  'import_local_files',
  'read_local_file',
  'computer',
] as const

const DESKTOP_TOOL_NAMES: ReadonlySet<string> = new Set(NAMED_DESKTOP_TOOL_NAMES)

/** Whether a call runs through the desktop app, including VFS reads of a granted local folder. */
export function isDesktopToolCall(toolName: string, args: Record<string, unknown> | undefined) {
  return DESKTOP_TOOL_NAMES.has(toolName) || isUserLocalVfsToolCall(toolName, args)
}

/**
 * The owner Electron claims a call as before acting on it, for the desktop tools whose pending
 * call is claimed atomically through `/api/desktop/tool/authorize`. Undefined for every other tool.
 */
export function getDesktopToolClaimOwner(toolName: string): DesktopToolClaimOwner | undefined {
  if (isCurrentBrowserToolName(toolName)) return DESKTOP_TOOL_CLAIM_OWNER.browser
  if (isTerminalToolName(toolName)) return DESKTOP_TOOL_CLAIM_OWNER.terminal
  if (toolName === 'computer') return DESKTOP_TOOL_CLAIM_OWNER.computer
  if (toolName === 'import_local_files') return DESKTOP_TOOL_CLAIM_OWNER.files
  return undefined
}

/**
 * Whether a call's result is accepted only under the desktop's native claim rules: the claimed
 * desktop tools, plus browser tools retired from the catalog whose calls remain in history.
 */
export function isNativeDesktopTool(toolName: string): boolean {
  return getDesktopToolClaimOwner(toolName) !== undefined || isBrowserToolName(toolName)
}

/** A read of the user's machine: `read_local_file`, or a VFS read of a granted local folder. */
export function isLocalReadToolCall(toolName: string, args: Record<string, unknown> | undefined) {
  return toolName === 'read_local_file' || isUserLocalVfsToolCall(toolName, args)
}

/**
 * Whether the server sees this call's pickup: the desktop claims it, pending, through
 * `/api/desktop/tool/authorize` before acting, so a call still pending has provably not started.
 * Browser, terminal and import calls are always claimed; a local read only by a desktop that
 * declared for the turn that it claims local reads.
 */
export function isClaimedOnPickup(
  toolName: string,
  args: Record<string, unknown> | undefined,
  desktopClaimsLocalReads: boolean
): boolean {
  return (
    getDesktopToolClaimOwner(toolName) !== undefined ||
    (desktopClaimsLocalReads && isLocalReadToolCall(toolName, args))
  )
}

/**
 * The claim owner a desktop background executor records. It is the per-surface owner the chat
 * view's claim records, so file transfer and download admission recognize it, with local reads
 * owned by the files surface; the run's `desktop_device_id` attributes it to a device.
 */
export function getDesktopExecutorClaimOwner(toolName: string): DesktopToolClaimOwner {
  return getDesktopToolClaimOwner(toolName) ?? DESKTOP_TOOL_CLAIM_OWNER.files
}

/** What the model learns about a desktop call that Stop cancelled before the desktop picked it up. */
export const STOPPED_BEFORE_START_MESSAGE =
  'Not run: the user stopped the chat before the Sim desktop app started this action. Nothing happened on their computer.'

/** What the model learns about a desktop call that Stop cancelled after the desktop picked it up. */
export const STOPPED_WHILE_RUNNING_MESSAGE =
  'Stopped by the user while the Sim desktop app was running this action. It may already have taken effect; inspect the current state before repeating it.'

/**
 * The lease owner token of a desktop call the chat view claims under a session: only that session
 * renews the lease.
 */
export function chatViewDesktopLeaseOwnerToken(sessionId: string): string {
  return `chat-view:${sessionId}`
}
