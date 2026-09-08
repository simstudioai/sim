import type { WorkspaceSearchFilters } from '@/lib/api/contracts/knowledge/search'
import type { ManagedMcpConnectorId } from '@/lib/credential-groups/managed-mcp-connectors'
import type { ChatContext } from '@/stores/panel'
import type { BrowserTextSelection, TerminalTextSelection } from '@/stores/panel/types'

const EDIT_CONTENT_TOOL_ID = 'apply_file_edit'
const RUN_SUBAGENT_ID = 'run'

export type {
  MothershipResource,
  MothershipResourceType,
  WorkspaceResourceRef,
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

/** Assistant searches as the signed-in person and uses their connected accounts. */
export type ChatRequestMode = 'assistant'

export interface QueuedMessage {
  id: string
  content: string
  fileAttachments?: FileAttachmentForApi[]
  contexts?: ChatContext[]
  requestMode?: ChatRequestMode
  assistantSearch?: WorkspaceSearchFilters
}

export const ToolCallStatus = {
  executing: 'executing',
  /** Held for the user's Allow / Always allow / Skip decision; nothing has run yet. */
  awaiting_approval: 'awaiting_approval',
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
  /** When execution started, for rows whose label changes as it runs. */
  startedAt?: number
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
  /**
   * Wall-clock the call opened. Carried separately from the block `timestamp`,
   * which falls back to a wire seq and so cannot be read as a clock.
   */
  startedAtMs?: number
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
  /** Orchestrator-chosen display name for a `subagent` start block (shown instead of the generic agent label). */
  subagentName?: string
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
  fileId?: string
  folderId?: string
  chatId?: string
  blockType?: string
  skillId?: string
  serverId?: string
  managedConnectorId?: ManagedMcpConnectorId
  /** Selected passage for a `file_selection` context. */
  text?: string
  /** Source file name for a `file_selection` context. */
  fileName?: string
  /** 1-based inclusive line range for a `file_selection` context. */
  startLine?: number
  endLine?: number
  /** Source table name for a `table_selection` context. */
  tableName?: string
  /** Selected row ids for a `table_selection` context. */
  rowIds?: string[]
  /** Selected column ids for a `table_selection` cell range. */
  columnIds?: string[]
  tabId?: string
  terminalId?: string
  selection?: BrowserTextSelection | TerminalTextSelection
}

export interface ChatMessage {
  id: string
  role: 'user' | 'assistant'
  requestMode?: 'agent' | 'assistant'
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
  platform: 'Platform Agent',
  superagent: 'Superagent',
  run: 'Run Agent',
  // The extensions subagent's wire/scope AgentID stays `agent` (pre-rename);
  // `extensions` is its current model-facing trigger tool name.
  agent: 'Extensions Agent',
  extensions: 'Extensions Agent',
  // `job` retained as a backward-compat alias so historical transcripts still render a label.
  job: 'Job Agent',
  file: 'File Agent',
  media: 'Media Agent',
  browser: 'Browser Agent',
} as const
