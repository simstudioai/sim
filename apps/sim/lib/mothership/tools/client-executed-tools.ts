import { isDesktopToolCall } from '@/lib/mothership/tools/desktop-tools'

/** The tools that run a workflow, in the browser or on the server. */
export const WORKFLOW_TOOL_NAMES = [
  'run_workflow',
  'run_workflow_until_block',
  'run_block',
  'run_from_block',
] as const

export function isWorkflowToolName(name: string): boolean {
  return (WORKFLOW_TOOL_NAMES as readonly string[]).includes(name)
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
