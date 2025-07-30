// localStorage persistence removed - STORAGE_KEYS no longer needed

export const API_ENDPOINTS = {
  SYNC: '/api/workflows/sync',
  ENVIRONMENT: '/api/environment',
  SCHEDULE: '/api/schedules',
  SETTINGS: '/api/settings',
  WORKFLOWS: '/api/workflows',
  WORKSPACE_PERMISSIONS: (id: string) => `/api/workspaces/${id}/permissions`,
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
  get_build_workflow_examples: 'Getting workflow examples',
  get_edit_workflow_examples: 'Getting workflow examples',
  get_environment_variables: 'Getting environment variables',
  set_environment_variables: 'Setting environment variables',
  get_workflow_console: 'Getting workflow console',
  edit_workflow: 'Updating workflow',
  search_online: 'Searching online',
} as const

export type CopilotToolId = keyof typeof COPILOT_TOOL_DISPLAY_NAMES
