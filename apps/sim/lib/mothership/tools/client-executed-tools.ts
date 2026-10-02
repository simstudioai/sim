import { isCurrentBrowserToolName } from '@sim/browser-protocol'
import { isTerminalToolName } from '@sim/terminal-protocol'
import { isNativeFileTool, isUserLocalVfsToolCall } from '@/lib/mothership/tools/local-filesystem'

const WORKFLOW_TOOL_NAMES = new Set<string>([
  'run_workflow',
  'run_workflow_until_block',
  'run_block',
  'run_from_block',
])

export function isWorkflowToolName(name: string): boolean {
  return WORKFLOW_TOOL_NAMES.has(name)
}

/**
 * Client-executed calls only the desktop app can run: local file access, the agent browser, and
 * the terminal. A web tab watching the same chat must leave them to the desktop app.
 */
export function isDesktopExecutedToolCall(
  name: string,
  args: Record<string, unknown> | undefined
): boolean {
  return (
    isNativeFileTool(name) ||
    isUserLocalVfsToolCall(name, args) ||
    isCurrentBrowserToolName(name) ||
    isTerminalToolName(name)
  )
}

/**
 * Tool calls the browser starts from the call frame's own arguments: workflow
 * runs, local file access, browser actions, and terminal commands. The stream
 * must deliver those arguments exactly as the model sent them.
 */
export function isClientExecutedToolCall(
  name: string,
  args: Record<string, unknown> | undefined
): boolean {
  return isWorkflowToolName(name) || isDesktopExecutedToolCall(name, args)
}
