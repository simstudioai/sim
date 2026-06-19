import {
  Agent,
  Auth,
  CreateWorkflow,
  Deploy,
  EditWorkflow,
  Ffmpeg,
  FunctionExecute,
  GenerateAudio,
  GenerateImage,
  GenerateVideo,
  GetPageContents,
  Glob,
  Grep,
  Knowledge,
  KnowledgeBase,
  ManageMcpTool,
  ManageSkill,
  Media,
  OpenResource,
  Read as ReadTool,
  Research,
  ScheduledTask,
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
  fileId?: string
  folderId?: string
  chatId?: string
  blockType?: string
  skillId?: string
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
  superagent: 'Superagent',
  run: 'Run Agent',
  agent: 'Tools Agent',
  scheduled_task: 'Scheduled Task Agent',
  // `job` retained as a backward-compat alias so historical transcripts still render a label.
  job: 'Job Agent',
  file: 'File Agent',
  media: 'Media Agent',
} as const

interface ToolTitleMetadata {
  title: string
}

/**
 * Fallback titles for tool calls when the stream did not provide one.
 */
export const TOOL_UI_METADATA: Record<string, ToolTitleMetadata> = {
  [Glob.id]: { title: 'Finding files' },
  [Grep.id]: { title: 'Searching' },
  [ReadTool.id]: { title: 'Reading file' },
  [SearchOnline.id]: { title: 'Searching online' },
  [ScrapePage.id]: { title: 'Scraping page' },
  [GetPageContents.id]: { title: 'Getting page contents' },
  [SearchLibraryDocs.id]: { title: 'Searching library docs' },
  [ManageMcpTool.id]: { title: 'MCP server action' },
  [ManageSkill.id]: { title: 'Skill action' },
  [UserMemory.id]: { title: 'Accessing memory' },
  [FunctionExecute.id]: { title: 'Running code' },
  [Superagent.id]: { title: 'Executing action' },
  [UserTable.id]: { title: 'Managing table' },
  [WorkspaceFile.id]: { title: 'Editing file' },
  [EDIT_CONTENT_TOOL_ID]: { title: 'Applying file content' },
  [CreateWorkflow.id]: { title: 'Creating workflow' },
  [EditWorkflow.id]: { title: 'Editing workflow' },
  [Workflow.id]: { title: 'Workflow Agent' },
  [RUN_SUBAGENT_ID]: { title: 'Run Agent' },
  [Deploy.id]: { title: 'Deploy Agent' },
  [Auth.id]: { title: 'Auth Agent' },
  [Knowledge.id]: { title: 'Knowledge Agent' },
  [KnowledgeBase.id]: { title: 'Managing knowledge base' },
  [Table.id]: { title: 'Table Agent' },
  [ScheduledTask.id]: { title: 'Scheduled Task Agent' },
  job: { title: 'Job Agent' },
  [Agent.id]: { title: 'Tools Agent' },
  custom_tool: { title: 'Creating tool' },
  [Research.id]: { title: 'Research Agent' },
  [OpenResource.id]: { title: 'Opening resource' },
  [Media.id]: { title: 'Media Agent' },
  [GenerateImage.id]: { title: 'Generating image' },
  [GenerateVideo.id]: { title: 'Generating video' },
  [GenerateAudio.id]: { title: 'Generating audio' },
  [Ffmpeg.id]: { title: 'Processing media' },
  context_compaction: { title: 'Compacted context' },
}
