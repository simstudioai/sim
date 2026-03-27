import {
  Agent,
  Auth,
  Build,
  CreateWorkflow,
  Debug,
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
  Run,
  ScrapePage,
  SearchLibraryDocs,
  SearchOnline,
  Superagent,
  Table,
  UserMemory,
  UserTable,
  WorkspaceFile,
} from '@/lib/copilot/generated/tool-catalog-v1'
import type { ChatContext } from '@/stores/panel'

export type {
  MothershipResource,
  MothershipResourceType,
} from '@/lib/copilot/resources/types'

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

export const SUBAGENT_LABELS: Record<string, string> = {
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
 * The backend may send `ui` on some `MothershipStreamV1EventType.tool` payloads (`phase: 'call'`);
 * this map provides fallback metadata when `ui` is absent.
 */
export const TOOL_UI_METADATA: Record<string, ToolUIMetadata> = {
  [Glob.id]: {
    title: 'Searching files',
    phaseLabel: 'Workspace',
    phase: 'workspace',
  },
  [Grep.id]: {
    title: 'Searching code',
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
    title: 'Managing MCP tool',
    phaseLabel: 'Management',
    phase: 'management',
  },
  [ManageSkill.id]: {
    title: 'Managing skill',
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
    title: 'Managing file',
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
  [Build.id]: { title: 'Building', phaseLabel: 'Build', phase: 'subagent' },
  [Run.id]: { title: 'Running', phaseLabel: 'Run', phase: 'subagent' },
  [Deploy.id]: { title: 'Deploying', phaseLabel: 'Deploy', phase: 'subagent' },
  [Auth.id]: {
    title: 'Connecting credentials',
    phaseLabel: 'Auth',
    phase: 'subagent',
  },
  [Knowledge.id]: {
    title: 'Managing knowledge',
    phaseLabel: 'Knowledge',
    phase: 'subagent',
  },
  [KnowledgeBase.id]: {
    title: 'Managing knowledge base',
    phaseLabel: 'Resource',
    phase: 'resource',
  },
  [Table.id]: { title: 'Managing tables', phaseLabel: 'Table', phase: 'subagent' },
  [Job.id]: { title: 'Managing jobs', phaseLabel: 'Job', phase: 'subagent' },
  [Agent.id]: { title: 'Agent action', phaseLabel: 'Agent', phase: 'subagent' },
  custom_tool: {
    title: 'Creating tool',
    phaseLabel: 'Tool',
    phase: 'subagent',
  },
  [Research.id]: { title: 'Researching', phaseLabel: 'Research', phase: 'subagent' },
  plan: { title: 'Planning', phaseLabel: 'Plan', phase: 'subagent' },
  [Debug.id]: { title: 'Debugging', phaseLabel: 'Debug', phase: 'subagent' },
  edit: { title: 'Editing workflow', phaseLabel: 'Edit', phase: 'subagent' },
  fast_edit: {
    title: 'Editing workflow',
    phaseLabel: 'Edit',
    phase: 'subagent',
  },
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
