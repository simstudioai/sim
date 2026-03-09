export type ToolCallStatus = 'executing' | 'success' | 'error'

export interface ToolCallInfo {
  id: string
  name: string
  status: ToolCallStatus
  displayTitle?: string
}

export type ContentBlockType = 'text' | 'tool_call' | 'subagent'

export interface ContentBlock {
  type: ContentBlockType
  content?: string
  toolCall?: ToolCallInfo
}

export interface ChatMessage {
  id: string
  role: 'user' | 'assistant'
  content: string
  contentBlocks?: ContentBlock[]
}

export const SUBAGENT_LABELS: Record<string, string> = {
  build: 'Building',
  deploy: 'Deploying',
  auth: 'Connecting credentials',
  research: 'Researching',
  knowledge: 'Managing knowledge base',
  table: 'Managing tables',
  custom_tool: 'Creating tool',
  superagent: 'Executing action',
  plan: 'Planning',
  debug: 'Debugging',
  edit: 'Editing workflow',
} as const

export interface SSEPayloadUI {
  hidden?: boolean
  title?: string
  phaseLabel?: string
}

export interface SSEPayloadData {
  name?: string
  ui?: SSEPayloadUI
  id?: string
  agent?: string
  arguments?: Record<string, unknown>
  input?: Record<string, unknown>
  result?: Record<string, unknown>
}

export interface SSEPayload {
  type: string
  chatId?: string
  data?: string | SSEPayloadData
  content?: string
  toolCallId?: string
  toolName?: string
  ui?: SSEPayloadUI
  success?: boolean
  error?: string
  subagent?: string
  result?: Record<string, unknown>
}

export type MothershipResourceType = 'table' | 'file'

export interface MothershipResource {
  type: MothershipResourceType
  id: string
  title: string
}
