import type { ChatContext } from '@/stores/panel'

const EDIT_CONTENT_TOOL_ID = 'edit_content'
const RUN_SUBAGENT_ID = 'run'

export type {
  MothershipResource,
  MothershipResourceType,
} from '@/lib/copilot/resources/types'

/** Union of all valid context kind strings, derived from {@link ChatContext}. */
export type ChatContextKind = ChatContext['kind']

export interface FileAttachmentForApi {
  id: string
  key: string
  filename: string
  media_type: string
  size: number
  path?: string
}

export interface QueuedMessage {
  id: string
  content: string
  fileAttachments?: FileAttachmentForApi[]
  contexts?: ChatContext[]
}

export const ToolCallStatus = {
  executing: 'executing',
  success: 'success',
  error: 'error',
  cancelled: 'cancelled',
  skipped: 'skipped',
  rejected: 'rejected',
  interrupted: 'interrupted',
} as const
export type ToolCallStatus = (typeof ToolCallStatus)[keyof typeof ToolCallStatus]

interface ToolCallResult {
  success: boolean
  output?: unknown
  error?: string
}

interface GenericResourceEntry {
  toolCallId: string
  toolName: string
  displayTitle: string
  status: ToolCallStatus
  params?: Record<string, unknown>
  streamingArgs?: string
  result?: ToolCallResult
}

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
  /** Model-authored activity phrase for a gateway-resolved integration call. */
  integrationDescription?: string
  params?: Record<string, unknown>
  calledBy?: string
  result?: ToolCallResult
  streamingArgs?: string
}

export interface OptionItem {
  id: string
  label: string
}

export const ContentBlockType = {
  text: 'text',
  thinking: 'thinking',
  tool_call: 'tool_call',
  subagent: 'subagent',
  subagent_end: 'subagent_end',
  subagent_text: 'subagent_text',
  subagent_thinking: 'subagent_thinking',
  options: 'options',
  stopped: 'stopped',
} as const
export type ContentBlockType = (typeof ContentBlockType)[keyof typeof ContentBlockType]

export interface ContentBlock {
  type: ContentBlockType
  content?: string
  subagent?: string
  toolCall?: ToolCallInfo
  options?: OptionItem[]
  timestamp?: number
  endedAt?: number
  parentToolCallId?: string
  /**
   * Deterministic agent-run identity. `spanId` is the stable per-invocation id
   * of the subagent that produced this block; `parentSpanId` links it to the
   * run that invoked it (empty/"main" for top-level). These are the primary
   * nesting keys used to build the agent tree; `parentToolCallId` is retained
   * for tool linkage and legacy back-compat.
   */
  spanId?: string
  parentSpanId?: string
}

export interface ChatMessageAttachment {
  id: string
  filename: string
  media_type: string
  size: number
  previewUrl?: string
}

export interface ChatMessageContext {
  kind: ChatContextKind
  label: string
  workflowId?: string
  knowledgeId?: string
  tableId?: string
  interfaceId?: string
  fileId?: string
  folderId?: string
  chatId?: string
  blockType?: string
  skillId?: string
  serverId?: string
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

export const SUBAGENT_LABELS: Record<string, string> = {
  workflow: 'Workflow Agent',
  debug: 'Debug Agent',
  deploy: 'Deploy Agent',
  auth: 'Auth Agent',
  research: 'Research Agent',
  knowledge: 'Knowledge Agent',
  table: 'Table Agent',
  custom_tool: 'Custom Tool Agent',
  scout: 'Scout Agent',
  search: 'Search Agent',
  superagent: 'Superagent',
  run: 'Run Agent',
  agent: 'Tools Agent',
  scheduled_task: 'Scheduled Task Agent',
  // `job` retained as a backward-compat alias so historical transcripts still render a label.
  job: 'Job Agent',
  file: 'File Agent',
  media: 'Media Agent',
} as const
