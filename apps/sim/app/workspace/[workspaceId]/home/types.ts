import type { MothershipResourceType } from '@/lib/copilot/resource-types'
import type { ChatContext } from '@/stores/panel'

export type {
  MothershipResource,
  MothershipResourceType,
} from '@/lib/copilot/resource-types'

export interface FileAttachmentForApi {
  id: string
  key: string
  filename: string
  media_type: string
  size: number
}

export interface QueuedMessage {
  id: string
  content: string
  fileAttachments?: FileAttachmentForApi[]
  contexts?: ChatContext[]
}

/**
 * SSE event types emitted by the Go orchestrator backend.
 *
 * @example
 * ```json
 * { "type": "content", "data": "Hello world" }
 * { "type": "tool_call", "state": "executing", "toolCallId": "toolu_...", "toolName": "glob", "ui": { "title": "..." } }
 * { "type": "subagent_start", "subagent": "build" }
 * ```
 */
export type SSEEventType =
  | 'chat_id'
  | 'request_id'
  | 'title_updated'
  | 'content'
  | 'reasoning' // openai reasoning - render as thinking text
  | 'tool_call' // tool call name
  | 'tool_call_delta' // chunk of tool call
  | 'tool_generating' // start a tool call
  | 'tool_result' // tool call result
  | 'tool_error' // tool call error
  | 'resource_added' // add a resource to the chat
  | 'resource_deleted' // delete a resource from the chat
  | 'subagent_start' // start a subagent
  | 'subagent_end' // end a subagent
  | 'structured_result' // structured result from a tool call
  | 'subagent_result' // result from a subagent
  | 'done' // end of the chat
  | 'context_compaction_start' // context compaction started
  | 'context_compaction' // conversation context was compacted
  | 'error' // error in the chat
  | 'start' // start of the chat

/**
 * All tool names observed in the mothership SSE stream, grouped by phase.
 *
 * @example
 * ```json
 * { "type": "tool_generating", "toolName": "glob" }
 * { "type": "tool_call", "toolName": "function_execute", "ui": { "title": "Running code", "icon": "code" } }
 * ```
 */
export type MothershipToolName =
  | 'glob'
  | 'grep'
  | 'read'
  | 'search_online'
  | 'scrape_page'
  | 'get_page_contents'
  | 'search_library_docs'
  | 'manage_mcp_tool'
  | 'manage_skill'
  | 'manage_credential'
  | 'manage_custom_tool'
  | 'manage_job'
  | 'user_memory'
  | 'function_execute'
  | 'superagent'
  | 'user_table'
  | 'workspace_file'
  | 'create_workflow'
  | 'delete_workflow'
  | 'edit_workflow'
  | 'rename_workflow'
  | 'move_workflow'
  | 'run_workflow'
  | 'run_block'
  | 'run_from_block'
  | 'run_workflow_until_block'
  | 'create_folder'
  | 'delete_folder'
  | 'move_folder'
  | 'list_folders'
  | 'list_user_workspaces'
  | 'create_job'
  | 'complete_job'
  | 'update_job_history'
  | 'download_to_workspace_file'
  | 'materialize_file'
  | 'context_write'
  | 'generate_image'
  | 'generate_visualization'
  | 'crawl_website'
  | 'get_execution_summary'
  | 'get_job_logs'
  | 'get_deployment_version'
  | 'revert_to_version'
  | 'check_deployment_status'
  | 'get_deployed_workflow_state'
  | 'get_workflow_data'
  | 'get_workflow_logs'
  | 'get_block_outputs'
  | 'get_block_upstream_references'
  | 'set_global_workflow_variables'
  | 'set_environment_variables'
  | 'get_platform_actions'
  | 'search_documentation'
  | 'search_patterns'
  | 'update_workspace_mcp_server'
  | 'delete_workspace_mcp_server'
  | 'create_workspace_mcp_server'
  | 'list_workspace_mcp_servers'
  | 'deploy_api'
  | 'deploy_chat'
  | 'deploy_mcp'
  | 'redeploy'
  | 'generate_api_key'
  | 'oauth_get_auth_link'
  | 'oauth_request_access'
  | 'build'
  | 'run'
  | 'deploy'
  | 'auth'
  | 'knowledge'
  | 'knowledge_base'
  | 'table'
  | 'job'
  | 'agent'
  | 'custom_tool'
  | 'research'
  | 'plan'
  | 'debug'
  | 'edit'
  | 'fast_edit'
  | 'open_resource'
  | 'context_compaction'

/**
 * Subagent identifiers dispatched via `subagent_start` SSE events.
 *
 * @example
 * ```json
 * { "type": "subagent_start", "subagent": "build" }
 * ```
 */
export type SubagentName =
  | 'build'
  | 'deploy'
  | 'auth'
  | 'research'
  | 'knowledge'
  | 'table'
  | 'custom_tool'
  | 'superagent'
  | 'plan'
  | 'debug'
  | 'edit'
  | 'fast_edit'
  | 'run'
  | 'agent'
  | 'job'
  | 'file_write'

export type ToolPhase =
  | 'workspace'
  | 'search'
  | 'management'
  | 'execution'
  | 'resource'
  | 'subagent'

export type ToolCallStatus = 'executing' | 'success' | 'error' | 'cancelled'

export interface ToolCallResult {
  success: boolean
  output?: unknown
  error?: string
}

/** A single tool call result entry in the generic Results resource tab. */
export interface GenericResourceEntry {
  toolCallId: string
  toolName: string
  displayTitle: string
  status: ToolCallStatus
  params?: Record<string, unknown>
  streamingArgs?: string
  result?: ToolCallResult
}

/** Accumulated feed of tool call results shown in the generic Results tab. */
export interface GenericResourceData {
  entries: GenericResourceEntry[]
}

export interface ToolCallData {
  id: string
  toolName: string
  displayTitle: string
  status: ToolCallStatus
  params?: Record<string, unknown>
  result?: ToolCallResult
  streamingArgs?: string
}

export interface ToolCallInfo {
  id: string
  name: string
  status: ToolCallStatus
  displayTitle?: string
  phaseLabel?: string
  params?: Record<string, unknown>
  calledBy?: string
  result?: { success: boolean; output?: unknown; error?: string }
  streamingArgs?: string
}

export interface OptionItem {
  id: string
  label: string
}

export type ContentBlockType =
  | 'text'
  | 'tool_call'
  | 'subagent'
  | 'subagent_end'
  | 'subagent_text'
  | 'options'
  | 'stopped'

export interface ContentBlock {
  type: ContentBlockType
  content?: string
  subagent?: string
  toolCall?: ToolCallInfo
  options?: OptionItem[]
}

export interface ChatMessageAttachment {
  id: string
  filename: string
  media_type: string
  size: number
  previewUrl?: string
}

export interface ChatMessageContext {
  kind: string
  label: string
  workflowId?: string
  knowledgeId?: string
  tableId?: string
  fileId?: string
}

export interface ChatMessage {
  id: string
  role: 'user' | 'assistant'
  content: string
  contentBlocks?: ContentBlock[]
  attachments?: ChatMessageAttachment[]
  contexts?: ChatMessageContext[]
  requestId?: string
}

export const SUBAGENT_LABELS: Record<SubagentName, string> = {
  build: 'Build agent',
  deploy: 'Deploy agent',
  auth: 'Integration agent',
  research: 'Research agent',
  knowledge: 'Knowledge agent',
  table: 'Table agent',
  custom_tool: 'Custom Tool agent',
  superagent: 'Superagent',
  plan: 'Plan agent',
  debug: 'Debug agent',
  edit: 'Edit agent',
  fast_edit: 'Build agent',
  run: 'Run agent',
  agent: 'Agent manager',
  job: 'Job agent',
  file_write: 'File Write',
} as const

export interface ToolUIMetadata {
  title: string
  phaseLabel: string
  phase: ToolPhase
}

/**
 * Primary UI metadata for tools observed in the SSE stream.
 * Maps tool IDs to human-readable display names shown in the chat.
 * This is the single source of truth — server-sent `ui.title` values are not used.
 */
export const TOOL_UI_METADATA: Record<MothershipToolName, ToolUIMetadata> = {
  // Workspace
  glob: { title: 'Searching workspace', phaseLabel: 'Workspace', phase: 'workspace' },
  grep: { title: 'Searching workspace', phaseLabel: 'Workspace', phase: 'workspace' },
  read: { title: 'Reading file', phaseLabel: 'Workspace', phase: 'workspace' },
  // Search
  search_online: { title: 'Searching online', phaseLabel: 'Search', phase: 'search' },
  scrape_page: { title: 'Reading webpage', phaseLabel: 'Search', phase: 'search' },
  get_page_contents: { title: 'Reading page', phaseLabel: 'Search', phase: 'search' },
  search_library_docs: { title: 'Searching docs', phaseLabel: 'Search', phase: 'search' },
  crawl_website: { title: 'Browsing website', phaseLabel: 'Search', phase: 'search' },
  // Execution
  function_execute: { title: 'Running code', phaseLabel: 'Code', phase: 'execution' },
  superagent: { title: 'Taking action', phaseLabel: 'Action', phase: 'execution' },
  run_workflow: { title: 'Running workflow', phaseLabel: 'Execution', phase: 'execution' },
  run_block: { title: 'Running block', phaseLabel: 'Execution', phase: 'execution' },
  run_from_block: { title: 'Running from block', phaseLabel: 'Execution', phase: 'execution' },
  run_workflow_until_block: {
    title: 'Running partial workflow',
    phaseLabel: 'Execution',
    phase: 'execution',
  },
  complete_job: { title: 'Completing job', phaseLabel: 'Execution', phase: 'execution' },
  get_execution_summary: { title: 'Checking results', phaseLabel: 'Execution', phase: 'execution' },
  get_job_logs: { title: 'Checking logs', phaseLabel: 'Execution', phase: 'execution' },
  get_workflow_logs: { title: 'Checking logs', phaseLabel: 'Execution', phase: 'execution' },
  get_workflow_data: { title: 'Loading workflow', phaseLabel: 'Execution', phase: 'execution' },
  get_block_outputs: {
    title: 'Checking block outputs',
    phaseLabel: 'Execution',
    phase: 'execution',
  },
  get_block_upstream_references: {
    title: 'Checking references',
    phaseLabel: 'Execution',
    phase: 'execution',
  },
  get_deployed_workflow_state: {
    title: 'Checking deployment',
    phaseLabel: 'Execution',
    phase: 'execution',
  },
  check_deployment_status: {
    title: 'Checking deployment',
    phaseLabel: 'Execution',
    phase: 'execution',
  },
  // Workflows & folders
  create_workflow: { title: 'Creating workflow', phaseLabel: 'Resource', phase: 'resource' },
  delete_workflow: { title: 'Deleting workflow', phaseLabel: 'Resource', phase: 'resource' },
  edit_workflow: { title: 'Editing workflow', phaseLabel: 'Resource', phase: 'resource' },
  rename_workflow: { title: 'Renaming workflow', phaseLabel: 'Resource', phase: 'resource' },
  move_workflow: { title: 'Moving workflow', phaseLabel: 'Resource', phase: 'resource' },
  create_folder: { title: 'Creating folder', phaseLabel: 'Resource', phase: 'resource' },
  delete_folder: { title: 'Deleting folder', phaseLabel: 'Resource', phase: 'resource' },
  move_folder: { title: 'Moving folder', phaseLabel: 'Resource', phase: 'resource' },
  list_folders: { title: 'Browsing folders', phaseLabel: 'Resource', phase: 'resource' },
  list_user_workspaces: { title: 'Browsing workspaces', phaseLabel: 'Resource', phase: 'resource' },
  revert_to_version: { title: 'Restoring version', phaseLabel: 'Resource', phase: 'resource' },
  get_deployment_version: {
    title: 'Checking deployment',
    phaseLabel: 'Resource',
    phase: 'resource',
  },
  open_resource: { title: 'Opening resource', phaseLabel: 'Resource', phase: 'resource' },
  // Files
  workspace_file: { title: 'Working with files', phaseLabel: 'Resource', phase: 'resource' },
  download_to_workspace_file: {
    title: 'Downloading file',
    phaseLabel: 'Resource',
    phase: 'resource',
  },
  materialize_file: { title: 'Saving file', phaseLabel: 'Resource', phase: 'resource' },
  generate_image: { title: 'Generating image', phaseLabel: 'Resource', phase: 'resource' },
  generate_visualization: {
    title: 'Generating visualization',
    phaseLabel: 'Resource',
    phase: 'resource',
  },
  // Tables & knowledge
  user_table: { title: 'Editing table', phaseLabel: 'Resource', phase: 'resource' },
  knowledge_base: { title: 'Updating knowledge base', phaseLabel: 'Resource', phase: 'resource' },
  // Jobs
  create_job: { title: 'Creating job', phaseLabel: 'Resource', phase: 'resource' },
  manage_job: { title: 'Updating job', phaseLabel: 'Management', phase: 'management' },
  update_job_history: { title: 'Updating job', phaseLabel: 'Management', phase: 'management' },
  // Management
  manage_mcp_tool: { title: 'Updating integration', phaseLabel: 'Management', phase: 'management' },
  manage_skill: { title: 'Updating skill', phaseLabel: 'Management', phase: 'management' },
  manage_credential: { title: 'Connecting account', phaseLabel: 'Management', phase: 'management' },
  manage_custom_tool: { title: 'Updating tool', phaseLabel: 'Management', phase: 'management' },
  update_workspace_mcp_server: {
    title: 'Updating MCP server',
    phaseLabel: 'Management',
    phase: 'management',
  },
  delete_workspace_mcp_server: {
    title: 'Removing MCP server',
    phaseLabel: 'Management',
    phase: 'management',
  },
  create_workspace_mcp_server: {
    title: 'Creating MCP server',
    phaseLabel: 'Management',
    phase: 'management',
  },
  list_workspace_mcp_servers: {
    title: 'Browsing MCP servers',
    phaseLabel: 'Management',
    phase: 'management',
  },
  oauth_get_auth_link: {
    title: 'Connecting account',
    phaseLabel: 'Management',
    phase: 'management',
  },
  oauth_request_access: {
    title: 'Connecting account',
    phaseLabel: 'Management',
    phase: 'management',
  },
  set_environment_variables: {
    title: 'Updating environment',
    phaseLabel: 'Management',
    phase: 'management',
  },
  set_global_workflow_variables: {
    title: 'Updating variables',
    phaseLabel: 'Management',
    phase: 'management',
  },
  get_platform_actions: { title: 'Loading actions', phaseLabel: 'Management', phase: 'management' },
  search_documentation: { title: 'Searching docs', phaseLabel: 'Search', phase: 'search' },
  search_patterns: { title: 'Searching patterns', phaseLabel: 'Search', phase: 'search' },
  deploy_api: { title: 'Deploying API', phaseLabel: 'Deploy', phase: 'management' },
  deploy_chat: { title: 'Deploying chat', phaseLabel: 'Deploy', phase: 'management' },
  deploy_mcp: { title: 'Deploying MCP', phaseLabel: 'Deploy', phase: 'management' },
  redeploy: { title: 'Redeploying', phaseLabel: 'Deploy', phase: 'management' },
  generate_api_key: { title: 'Generating API key', phaseLabel: 'Deploy', phase: 'management' },
  user_memory: { title: 'Updating memory', phaseLabel: 'Management', phase: 'management' },
  context_write: { title: 'Writing notes', phaseLabel: 'Management', phase: 'management' },
  context_compaction: {
    title: 'Optimizing context',
    phaseLabel: 'Management',
    phase: 'management',
  },
  // Subagents
  build: { title: 'Building', phaseLabel: 'Build', phase: 'subagent' },
  run: { title: 'Running', phaseLabel: 'Run', phase: 'subagent' },
  deploy: { title: 'Deploying', phaseLabel: 'Deploy', phase: 'subagent' },
  auth: { title: 'Connecting integration', phaseLabel: 'Auth', phase: 'subagent' },
  knowledge: { title: 'Working with knowledge', phaseLabel: 'Knowledge', phase: 'subagent' },
  table: { title: 'Working with tables', phaseLabel: 'Table', phase: 'subagent' },
  job: { title: 'Working with jobs', phaseLabel: 'Job', phase: 'subagent' },
  agent: { title: 'Taking action', phaseLabel: 'Agent', phase: 'subagent' },
  custom_tool: { title: 'Creating tool', phaseLabel: 'Tool', phase: 'subagent' },
  research: { title: 'Researching', phaseLabel: 'Research', phase: 'subagent' },
  plan: { title: 'Planning', phaseLabel: 'Plan', phase: 'subagent' },
  debug: { title: 'Debugging', phaseLabel: 'Debug', phase: 'subagent' },
  edit: { title: 'Editing workflow', phaseLabel: 'Edit', phase: 'subagent' },
  fast_edit: { title: 'Editing workflow', phaseLabel: 'Edit', phase: 'subagent' },
}

export interface SSEPayloadUI {
  hidden?: boolean
  title?: string
  phaseLabel?: string
  icon?: string
  internal?: boolean
  clientExecutable?: boolean
}

export interface SSEPayloadData {
  name?: string
  ui?: SSEPayloadUI
  id?: string
  agent?: string
  partial?: boolean
  arguments?: Record<string, unknown>
  input?: Record<string, unknown>
  result?: unknown
  error?: string
}

export interface SSEPayload {
  type: SSEEventType | (string & {})
  chatId?: string
  data?: string | SSEPayloadData
  content?: string
  toolCallId?: string
  toolName?: string
  ui?: SSEPayloadUI
  success?: boolean
  result?: unknown
  error?: string
  subagent?: string
  resource?: { type: MothershipResourceType; id: string; title: string }
}
