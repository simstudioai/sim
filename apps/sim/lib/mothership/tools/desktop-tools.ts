import { CURRENT_BROWSER_TOOL_NAMES, isCurrentBrowserToolName } from '@sim/browser-protocol'
import { isTerminalToolName, TERMINAL_TOOL_NAME } from '@sim/terminal-protocol'
import { DESKTOP_TOOL_CLAIM_OWNER } from '@/lib/mothership/async-runs/lifecycle'
import { isUserLocalVfsToolCall } from '@/lib/mothership/tools/local-filesystem'

/**
 * The one place that answers "is this a desktop tool": the calls that act on the user's machine
 * through the Sim desktop app rather than on Sim's servers.
 */

export type DesktopToolClaimOwner =
  (typeof DESKTOP_TOOL_CLAIM_OWNER)[keyof typeof DESKTOP_TOOL_CLAIM_OWNER]

const DESKTOP_TOOL_NAMES: ReadonlySet<string> = new Set([
  ...CURRENT_BROWSER_TOOL_NAMES,
  TERMINAL_TOOL_NAME,
  'import_local_files',
  'read_local_file',
])

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
  if (toolName === 'import_local_files') return DESKTOP_TOOL_CLAIM_OWNER.files
  return undefined
}

/** What the model learns about a desktop call that Stop cancelled before the desktop picked it up. */
export const STOPPED_BEFORE_START_MESSAGE =
  'Not run: the user stopped the chat before the Sim desktop app started this action. Nothing happened on their computer.'

/** What the model learns about a desktop call that Stop cancelled after the desktop picked it up. */
export const STOPPED_WHILE_RUNNING_MESSAGE =
  'Stopped by the user while the Sim desktop app was running this action. It may already have taken effect; inspect the current state before repeating it.'
