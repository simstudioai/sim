import { CURRENT_BROWSER_TOOL_NAMES, isCurrentBrowserToolName } from '@sim/browser-protocol'
import { isTerminalToolName, TERMINAL_TOOL_NAME } from '@sim/terminal-protocol'
import { DESKTOP_TOOL_CLAIM_OWNER } from '@/lib/mothership/async-runs/lifecycle'
import { toolRequiresApprovalLane } from '@/lib/mothership/tool-executor/router'
import { isNativeFileTool, isUserLocalVfsToolCall } from '@/lib/mothership/tools/local-filesystem'

/**
 * Every tool name {@link isDesktopExecutorTool} can accept; `read`, `grep` and `glob` qualify only
 * for user-local paths, which the predicate checks.
 */
export const DESKTOP_EXECUTOR_TOOL_NAMES = [
  ...CURRENT_BROWSER_TOOL_NAMES,
  TERMINAL_TOOL_NAME,
  'read_local_file',
  'import_local_files',
  'read',
  'grep',
  'glob',
] as const

type DesktopClaimOwner = (typeof DESKTOP_TOOL_CLAIM_OWNER)[keyof typeof DESKTOP_TOOL_CLAIM_OWNER]

/**
 * The calls a desktop background executor runs: the same set the legacy authorize route lets the
 * desktop app execute natively.
 */
export function isDesktopExecutorTool(
  toolName: string,
  args: Record<string, unknown> | undefined
): boolean {
  return (
    isCurrentBrowserToolName(toolName) ||
    isTerminalToolName(toolName) ||
    isNativeFileTool(toolName) ||
    isUserLocalVfsToolCall(toolName, args)
  )
}

/**
 * The claim owner recorded on a call the executor holds. It is the same per-surface owner the
 * legacy path records, so file transfer and download admission keep recognizing the claim; the
 * run's `desktop_device_id` attributes it to a device.
 */
export function desktopClaimOwner(toolName: string): DesktopClaimOwner {
  if (isCurrentBrowserToolName(toolName)) return DESKTOP_TOOL_CLAIM_OWNER.browser
  if (isTerminalToolName(toolName)) return DESKTOP_TOOL_CLAIM_OWNER.terminal
  return DESKTOP_TOOL_CLAIM_OWNER.files
}

/**
 * Whether a call of this shape is held for the user's approval before it runs. Mirrors the static
 * half of the dispatch gate: nothing is gated while tool permissions are off, and only running a
 * terminal command is gated, never reading one.
 */
export function desktopCallAwaitsApproval(
  toolName: string,
  args: Record<string, unknown> | undefined
): boolean {
  if (!toolRequiresApprovalLane(toolName)) return false
  return toolName !== TERMINAL_TOOL_NAME || args?.operation === 'run'
}
