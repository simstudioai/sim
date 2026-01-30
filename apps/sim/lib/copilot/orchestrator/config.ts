/**
 * Feature flag for server-side copilot orchestration.
 */
export const COPILOT_SERVER_ORCHESTRATED = true

export const INTERRUPT_TOOL_NAMES = [
  'set_global_workflow_variables',
  'run_workflow',
  'manage_mcp_tool',
  'manage_custom_tool',
  'deploy_mcp',
  'deploy_chat',
  'deploy_api',
  'create_workspace_mcp_server',
  'set_environment_variables',
  'make_api_request',
  'oauth_request_access',
  'navigate_ui',
  'knowledge_base',
] as const

export const INTERRUPT_TOOL_SET = new Set<string>(INTERRUPT_TOOL_NAMES)

