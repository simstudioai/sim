export const WORKFLOW_TOOL_NAMES = [
  'run_workflow',
  'run_workflow_until_block',
  'run_block',
  'run_from_block',
] as const

export const WORKFLOW_TOOL_NAME_SET = new Set<string>(WORKFLOW_TOOL_NAMES)

export function isWorkflowToolName(name: string): boolean {
  return WORKFLOW_TOOL_NAME_SET.has(name)
}
