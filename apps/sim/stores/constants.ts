export const API_ENDPOINTS = {
  SYNC: '/api/workflows/sync',
  ENVIRONMENT: '/api/environment',
  SCHEDULE: '/api/schedules',
  SETTINGS: '/api/settings',
  WORKFLOWS: '/api/workflows',
  WORKSPACE_PERMISSIONS: (id: string) => `/api/workspaces/${id}/permissions`,
  WORKSPACE_ENVIRONMENT: (id: string) => `/api/workspaces/${id}/environment`,
}

// Removed SYNC_INTERVALS - Socket.IO handles real-time sync

// Copilot tool display names - shared between client and server
export const COPILOT_TOOL_DISPLAY_NAMES: Record<string, string> = {
  search_documentation: 'Searching documentation',
  get_user_workflow: 'Analyzing your workflow',
  build_workflow: 'Building your workflow',
  get_blocks_and_tools: 'Getting block information',
  get_blocks_metadata: 'Getting block metadata',
  get_yaml_structure: 'Analyzing workflow structure',
  get_build_workflow_examples: 'Viewing workflow examples',
  get_edit_workflow_examples: 'Viewing workflow examples',
  get_environment_variables: 'Viewing environment variables',
  set_environment_variables: 'Setting environment variables',
  get_workflow_console: 'Reading workflow console',
  edit_workflow: 'Updating workflow',
  run_workflow: 'Executing workflow',
  search_online: 'Searching online',
  plan: 'Designing an approach',
  reason: 'Reasoning about your workflow',
} as const

// Past tense versions for completed tool calls
export const COPILOT_TOOL_PAST_TENSE: Record<string, string> = {
  search_documentation: 'Searched documentation',
  get_user_workflow: 'Analyzed your workflow',
  build_workflow: 'Built your workflow',
  get_blocks_and_tools: 'Retrieved block information',
  get_blocks_metadata: 'Retrieved block metadata',
  get_yaml_structure: 'Analyzed workflow structure',
  get_build_workflow_examples: 'Viewed workflow examples',
  get_edit_workflow_examples: 'Viewed workflow examples',
  get_environment_variables: 'Found environment variables',
  set_environment_variables: 'Set environment variables',
  get_workflow_console: 'Read workflow console',
  edit_workflow: 'Updated workflow',
  run_workflow: 'Executed workflow',
  search_online: 'Searched online',
  plan: 'Designed an approach',
  reason: 'Finished reasoning',
} as const

// Error versions for failed tool calls
export const COPILOT_TOOL_ERROR_NAMES: Record<string, string> = {
  search_documentation: 'Errored searching documentation',
  get_user_workflow: 'Errored analyzing your workflow',
  build_workflow: 'Errored building your workflow',
  get_blocks_and_tools: 'Errored getting block information',
  get_blocks_metadata: 'Errored getting block metadata',
  get_yaml_structure: 'Errored analyzing workflow structure',
  get_build_workflow_examples: 'Errored getting workflow examples',
  get_edit_workflow_examples: 'Errored getting workflow examples',
  get_environment_variables: 'Errored getting environment variables',
  set_environment_variables: 'Errored setting environment variables',
  get_workflow_console: 'Errored getting workflow console',
  edit_workflow: 'Errored updating workflow',
  run_workflow: 'Errored running workflow',
  search_online: 'Errored searching online',
  plan: 'Errored planning approach',
  reason: 'Errored reasoning through problem',
} as const

export type CopilotToolId = keyof typeof COPILOT_TOOL_DISPLAY_NAMES
