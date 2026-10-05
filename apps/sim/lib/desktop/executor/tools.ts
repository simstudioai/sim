import { isCurrentBrowserToolName } from '@sim/browser-protocol'
import { isTerminalToolName, TERMINAL_TOOL_NAME } from '@sim/terminal-protocol'
import { DESKTOP_TOOL_CLAIM_OWNER } from '@/lib/mothership/async-runs/lifecycle'
import { toolRequiresApproval } from '@/lib/mothership/tool-executor/router'
import { isNativeFileTool, isUserLocalVfsToolCall } from '@/lib/mothership/tools/local-filesystem'

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
 * half of the dispatch gate: only running a terminal command is gated, never reading one.
 */
export function desktopCallAwaitsApproval(
  toolName: string,
  args: Record<string, unknown> | undefined
): boolean {
  if (!toolRequiresApproval(toolName)) return false
  return toolName !== TERMINAL_TOOL_NAME || args?.operation === 'run'
}
