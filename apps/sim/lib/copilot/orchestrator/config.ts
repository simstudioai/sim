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

export const SUBAGENT_TOOL_NAMES = [
  'debug',
  'edit',
  'plan',
  'test',
  'deploy',
  'auth',
  'research',
  'knowledge',
  'custom_tool',
  'tour',
  'info',
  'workflow',
  'evaluate',
  'superagent',
] as const

export const SUBAGENT_TOOL_SET = new Set<string>(SUBAGENT_TOOL_NAMES)
