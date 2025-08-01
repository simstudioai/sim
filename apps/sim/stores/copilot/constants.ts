// Client-side constants for copilot tools
// These are safe to import in client code since they don't pull in server dependencies

export const COPILOT_TOOL_IDS = {
  SEARCH_DOCUMENTATION: 'search_documentation',
  GET_USER_WORKFLOW: 'get_user_workflow',
  BUILD_WORKFLOW: 'build_workflow',
  GET_BLOCKS_AND_TOOLS: 'get_blocks_and_tools',
  GET_BLOCKS_METADATA: 'get_blocks_metadata',
  GET_YAML_STRUCTURE: 'get_yaml_structure',
  GET_WORKFLOW_EXAMPLES: 'get_workflow_examples',
  GET_ENVIRONMENT_VARIABLES: 'get_environment_variables',
  SET_ENVIRONMENT_VARIABLES: 'set_environment_variables',
  GET_WORKFLOW_CONSOLE: 'get_workflow_console',
  EDIT_WORKFLOW: 'edit_workflow',
  RUN_WORKFLOW: 'run_workflow',
  SEARCH_ONLINE: 'search_online',
} as const

// Tools that require user interruption/approval
export const TOOLS_REQUIRING_INTERRUPT = new Set([
  COPILOT_TOOL_IDS.SET_ENVIRONMENT_VARIABLES,
  COPILOT_TOOL_IDS.RUN_WORKFLOW,
])

// Helper function to check if a tool requires interrupt
export function toolRequiresInterrupt(toolId: string): boolean {
  return TOOLS_REQUIRING_INTERRUPT.has(toolId as any)
}
