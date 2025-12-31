export const API_ENDPOINTS = {
  ENVIRONMENT: '/api/environment',
  SETTINGS: '/api/settings',
  WORKFLOWS: '/api/workflows',
  WORKSPACE_PERMISSIONS: (id: string) => `/api/workspaces/${id}/permissions`,
  WORKSPACE_ENVIRONMENT: (id: string) => `/api/workspaces/${id}/environment`,
  WORKSPACE_BYOK_KEYS: (id: string) => `/api/workspaces/${id}/byok-keys`,
}

export const COPILOT_TOOL_DISPLAY_NAMES: Record<string, string> = {
  search_documentation: 'Searching documentation',
  get_user_workflow: 'Analyzing your workflow',
  get_blocks_and_tools: 'Getting block information',
  get_blocks_metadata: 'Getting block metadata',
  get_yaml_structure: 'Analyzing workflow structure',
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

export const COPILOT_TOOL_PAST_TENSE: Record<string, string> = {
  search_documentation: 'Searched documentation',
  get_user_workflow: 'Analyzed your workflow',
  get_blocks_and_tools: 'Retrieved block information',
  get_blocks_metadata: 'Retrieved block metadata',
  get_yaml_structure: 'Analyzed workflow structure',
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

export const COPILOT_TOOL_ERROR_NAMES: Record<string, string> = {
  search_documentation: 'Errored searching documentation',
  get_user_workflow: 'Errored analyzing your workflow',
  get_blocks_and_tools: 'Errored getting block information',
  get_blocks_metadata: 'Errored getting block metadata',
  get_yaml_structure: 'Errored analyzing workflow structure',
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

/**
 * Layout dimension constants.
 *
 * These values must stay in sync with:
 * - `globals.css` (CSS variable defaults)
 * - `layout.tsx` (blocking script validations)
 *
 * @see globals.css for CSS variable definitions
 * @see layout.tsx for pre-hydration script that reads localStorage
 */

/** Sidebar width constraints */
export const SIDEBAR_WIDTH = {
  DEFAULT: 232,
  MIN: 232,
  /** Maximum is 30% of viewport, enforced dynamically */
  MAX_PERCENTAGE: 0.3,
} as const

/** Right panel width constraints */
export const PANEL_WIDTH = {
  DEFAULT: 290,
  MIN: 290,
  /** Maximum is 40% of viewport, enforced dynamically */
  MAX_PERCENTAGE: 0.4,
} as const

/** Terminal height constraints */
export const TERMINAL_HEIGHT = {
  DEFAULT: 155,
  MIN: 30,
  /** Maximum is 70% of viewport, enforced dynamically */
  MAX_PERCENTAGE: 0.7,
} as const

/** Toolbar triggers section height constraints */
export const TOOLBAR_TRIGGERS_HEIGHT = {
  DEFAULT: 300,
  MIN: 30,
  MAX: 800,
} as const

/** Editor connections section height constraints */
export const EDITOR_CONNECTIONS_HEIGHT = {
  DEFAULT: 172,
  MIN: 30,
  MAX: 300,
} as const

/** Output panel (terminal execution results) width constraints */
export const OUTPUT_PANEL_WIDTH = {
  DEFAULT: 440,
  MIN: 440,
} as const
