import { isDesktopToolCall } from '@/lib/mothership/tools/desktop-tools'

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
 * Tool calls the browser starts from the call frame's own arguments: workflow
 * runs, local file access, browser actions, and terminal commands. The stream
 * must deliver those arguments exactly as the model sent them.
 */
export function isClientExecutedToolCall(
  name: string,
  args: Record<string, unknown> | undefined
): boolean {
  return isWorkflowToolName(name) || isDesktopToolCall(name, args)
}
