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
  | 'user_memory'
  | 'function_execute'
  | 'superagent'
  | 'user_table'
  | 'workspace_file'
  | 'create_workflow'
  | 'edit_workflow'
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
 * Default UI metadata for tools observed in the SSE stream.
 * The Go backend sends `ui` on some tool_call events; this map provides
 * fallback metadata for tools that arrive via `tool_generating` without `ui`.
 */
export const TOOL_UI_METADATA: Partial<Record<MothershipToolName, ToolUIMetadata>> = {
  glob: {
    title: 'Searching files',
    phaseLabel: 'Workspace',
    phase: 'workspace',
  },
  grep: {
    title: 'Searching code',
    phaseLabel: 'Workspace',
    phase: 'workspace',
  },
  read: { title: 'Reading file', phaseLabel: 'Workspace', phase: 'workspace' },
  search_online: {
    title: 'Searching online',
    phaseLabel: 'Search',
    phase: 'search',
  },
  scrape_page: {
    title: 'Scraping page',
    phaseLabel: 'Search',
    phase: 'search',
  },
  get_page_contents: {
    title: 'Getting page contents',
    phaseLabel: 'Search',
    phase: 'search',
  },
  search_library_docs: {
    title: 'Searching library docs',
    phaseLabel: 'Search',
    phase: 'search',
  },
  manage_mcp_tool: {
    title: 'Managing MCP tool',
    phaseLabel: 'Management',
    phase: 'management',
  },
  manage_skill: {
    title: 'Managing skill',
    phaseLabel: 'Management',
    phase: 'management',
  },
  user_memory: {
    title: 'Accessing memory',
    phaseLabel: 'Management',
    phase: 'management',
  },
  function_execute: {
    title: 'Running code',
    phaseLabel: 'Code',
    phase: 'execution',
  },
  superagent: {
    title: 'Executing action',
    phaseLabel: 'Action',
    phase: 'execution',
  },
  user_table: {
    title: 'Managing table',
    phaseLabel: 'Resource',
    phase: 'resource',
  },
  workspace_file: {
    title: 'Managing file',
    phaseLabel: 'Resource',
    phase: 'resource',
  },
  create_workflow: {
    title: 'Creating workflow',
    phaseLabel: 'Resource',
    phase: 'resource',
  },
  edit_workflow: {
    title: 'Editing workflow',
    phaseLabel: 'Resource',
    phase: 'resource',
  },
  build: { title: 'Building', phaseLabel: 'Build', phase: 'subagent' },
  run: { title: 'Running', phaseLabel: 'Run', phase: 'subagent' },
  deploy: { title: 'Deploying', phaseLabel: 'Deploy', phase: 'subagent' },
  auth: {
    title: 'Connecting credentials',
    phaseLabel: 'Auth',
    phase: 'subagent',
  },
  knowledge: {
    title: 'Managing knowledge',
    phaseLabel: 'Knowledge',
    phase: 'subagent',
  },
  knowledge_base: {
    title: 'Managing knowledge base',
    phaseLabel: 'Resource',
    phase: 'resource',
  },
  table: { title: 'Managing tables', phaseLabel: 'Table', phase: 'subagent' },
  job: { title: 'Managing jobs', phaseLabel: 'Job', phase: 'subagent' },
  agent: { title: 'Agent action', phaseLabel: 'Agent', phase: 'subagent' },
  custom_tool: {
    title: 'Creating tool',
    phaseLabel: 'Tool',
    phase: 'subagent',
  },
  research: { title: 'Researching', phaseLabel: 'Research', phase: 'subagent' },
  plan: { title: 'Planning', phaseLabel: 'Plan', phase: 'subagent' },
  debug: { title: 'Debugging', phaseLabel: 'Debug', phase: 'subagent' },
  edit: { title: 'Editing workflow', phaseLabel: 'Edit', phase: 'subagent' },
  fast_edit: {
    title: 'Editing workflow',
    phaseLabel: 'Edit',
    phase: 'subagent',
  },
  open_resource: {
    title: 'Opening resource',
    phaseLabel: 'Resource',
    phase: 'resource',
  },
  context_compaction: {
    title: 'Compacted context',
    phaseLabel: 'Context',
    phase: 'management',
  },
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
