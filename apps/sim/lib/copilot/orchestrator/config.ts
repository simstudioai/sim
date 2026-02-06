export const INTERRUPT_TOOL_NAMES = [
  'set_global_workflow_variables',
  'run_workflow',
  'run_workflow_until_block',
  'run_from_block',
  'run_block',
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
  'generate_api_key',
] as const

export const INTERRUPT_TOOL_SET = new Set<string>(INTERRUPT_TOOL_NAMES)

export const SUBAGENT_TOOL_NAMES = [
  'debug',
  'edit',
  'build',
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
  'discovery',
] as const

export const SUBAGENT_TOOL_SET = new Set<string>(SUBAGENT_TOOL_NAMES)

/**
 * Respond tools are internal to the copilot's subagent system.
 * They're used by subagents to signal completion and should NOT be executed by the sim side.
 * The copilot backend handles these internally.
 */
export const RESPOND_TOOL_NAMES = [
  'plan_respond',
  'edit_respond',
  'build_respond',
  'debug_respond',
  'info_respond',
  'research_respond',
  'deploy_respond',
  'superagent_respond',
  'discovery_respond',
  'tour_respond',
  'auth_respond',
  'workflow_respond',
  'knowledge_respond',
  'custom_tool_respond',
  'test_respond',
] as const

export const RESPOND_TOOL_SET = new Set<string>(RESPOND_TOOL_NAMES)
