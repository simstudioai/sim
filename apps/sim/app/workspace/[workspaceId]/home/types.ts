import {
  Agent,
  Auth,
  CreateWorkflow,
  Deploy,
  EditWorkflow,
  FunctionExecute,
  GetPageContents,
  Glob,
  Grep,
  Job,
  Knowledge,
  KnowledgeBase,
  ManageMcpTool,
  ManageSkill,
  OpenResource,
  Read as ReadTool,
  Research,
  ScrapePage,
  SearchLibraryDocs,
  SearchOnline,
  Superagent,
  Table,
  UserMemory,
  UserTable,
  Workflow,
  WorkspaceFile,
} from '@/lib/copilot/generated/tool-catalog-v1'
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
}

export interface QueuedMessage {
  id: string
  content: string
  fileAttachments?: FileAttachmentForApi[]
  contexts?: ChatContext[]
}

/**
 * All tool names observed in the mothership SSE stream, grouped by phase.
 *
 * @example
 * ```json
 * { "type": "tool", "phase": "call", "toolName": "glob" }
 * { "type": "tool", "phase": "call", "toolName": "function_execute", "ui": { "title": "Running code", "icon": "code" } }
 * ```
 * Stream `type` is `MothershipStreamV1EventType.tool` (`mothership-stream-v1`) with `phase: 'call'`.
 */

export const ToolPhase = {
  workspace: 'workspace',
  search: 'search',
  management: 'management',
  execution: 'execution',
  resource: 'resource',
  subagent: 'subagent',
} as const
export type ToolPhase = (typeof ToolPhase)[keyof typeof ToolPhase]

export const ToolCallStatus = {
  executing: 'executing',
  success: 'success',
  error: 'error',
  cancelled: 'cancelled',
} as const
export type ToolCallStatus = (typeof ToolCallStatus)[keyof typeof ToolCallStatus]

export interface ToolCallResult {
  success: boolean
  output?: unknown
  error?: string
}

export interface GenericResourceEntry {
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
  phaseLabel?: string
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
  deploy: 'Deploy Agent',
  auth: 'Auth Agent',
  research: 'Research Agent',
  knowledge: 'Knowledge Agent',
  table: 'Table Agent',
  custom_tool: 'Custom Tool Agent',
  superagent: 'Superagent',
  run: 'Run Agent',
  agent: 'Tools Agent',
  job: 'Job Agent',
  file: 'File Agent',
} as const

export interface ToolUIMetadata {
  title: string
  phaseLabel: string
  phase: ToolPhase
}

/**
 * Default UI metadata for tools observed in the SSE stream.
 * The backend may send `ui` on some `MothershipStreamV1EventType.tool` payloads (`phase: 'call'`);
 * this map provides fallback metadata when `ui` is absent.
 */
export const TOOL_UI_METADATA: Record<string, ToolUIMetadata> = {
  [Glob.id]: {
    title: 'Finding files',
    phaseLabel: 'Workspace',
    phase: 'workspace',
  },
  [Grep.id]: {
    title: 'Searching',
    phaseLabel: 'Workspace',
    phase: 'workspace',
  },
  [ReadTool.id]: { title: 'Reading file', phaseLabel: 'Workspace', phase: 'workspace' },
  [SearchOnline.id]: {
    title: 'Searching online',
    phaseLabel: 'Search',
    phase: 'search',
  },
  [ScrapePage.id]: {
    title: 'Scraping page',
    phaseLabel: 'Search',
    phase: 'search',
  },
  [GetPageContents.id]: {
    title: 'Getting page contents',
    phaseLabel: 'Search',
    phase: 'search',
  },
  [SearchLibraryDocs.id]: {
    title: 'Searching library docs',
    phaseLabel: 'Search',
    phase: 'search',
  },
  [ManageMcpTool.id]: {
    title: 'MCP server action',
    phaseLabel: 'Management',
    phase: 'management',
  },
  [ManageSkill.id]: {
    title: 'Skill action',
    phaseLabel: 'Management',
    phase: 'management',
  },
  [UserMemory.id]: {
    title: 'Accessing memory',
    phaseLabel: 'Management',
    phase: 'management',
  },
  [FunctionExecute.id]: {
    title: 'Running code',
    phaseLabel: 'Code',
    phase: 'execution',
  },
  [Superagent.id]: {
    title: 'Executing action',
    phaseLabel: 'Action',
    phase: 'execution',
  },
  [UserTable.id]: {
    title: 'Managing table',
    phaseLabel: 'Resource',
    phase: 'resource',
  },
  [WorkspaceFile.id]: {
    title: 'Editing file',
    phaseLabel: 'Resource',
    phase: 'resource',
  },
  [EDIT_CONTENT_TOOL_ID]: {
    title: 'Applying file content',
    phaseLabel: 'Resource',
    phase: 'resource',
  },
  [CreateWorkflow.id]: {
    title: 'Creating workflow',
    phaseLabel: 'Resource',
    phase: 'resource',
  },
  [EditWorkflow.id]: {
    title: 'Editing workflow',
    phaseLabel: 'Resource',
    phase: 'resource',
  },
  [Workflow.id]: { title: 'Workflow Agent', phaseLabel: 'Workflow', phase: 'subagent' },
  [RUN_SUBAGENT_ID]: { title: 'Run Agent', phaseLabel: 'Run', phase: 'subagent' },
  [Deploy.id]: { title: 'Deploy Agent', phaseLabel: 'Deploy', phase: 'subagent' },
  [Auth.id]: {
    title: 'Auth Agent',
    phaseLabel: 'Auth',
    phase: 'subagent',
  },
  [Knowledge.id]: {
    title: 'Knowledge Agent',
    phaseLabel: 'Knowledge',
    phase: 'subagent',
  },
  [KnowledgeBase.id]: {
    title: 'Managing knowledge base',
    phaseLabel: 'Resource',
    phase: 'resource',
  },
  [Table.id]: { title: 'Table Agent', phaseLabel: 'Table', phase: 'subagent' },
  [Job.id]: { title: 'Job Agent', phaseLabel: 'Job', phase: 'subagent' },
  [Agent.id]: { title: 'Tools Agent', phaseLabel: 'Agent', phase: 'subagent' },
  custom_tool: {
    title: 'Creating tool',
    phaseLabel: 'Tool',
    phase: 'subagent',
  },
  [Research.id]: { title: 'Research Agent', phaseLabel: 'Research', phase: 'subagent' },
  [OpenResource.id]: {
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
