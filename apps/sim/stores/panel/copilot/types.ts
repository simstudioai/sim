import type { ServerToolUI } from '@/lib/copilot/store-utils'
import type {
  ClientToolCallState,
  ClientToolDisplay,
} from '@/lib/copilot/tools/client/tool-display-registry'
import type { ChatContext as PanelChatContext } from '@/stores/panel/types'

export type ChatContext = PanelChatContext

export interface CopilotToolCall {
  id: string
  name: string
  state: ClientToolCallState
  display?: ClientToolDisplay
  params?: Record<string, unknown>
  input?: Record<string, unknown>
  serverUI?: ServerToolUI
  clientExecutable?: boolean
  result?: { success: boolean; output?: unknown; error?: string }
  error?: string
  calledBy?: string
  streamingArgs?: string
}

export interface SubAgentContentBlock {
  type: string
  content?: string
  toolCall?: CopilotToolCall | null
}

export interface CopilotStreamInfo {
  chatId?: string
  streamId?: string
  messageId?: string
}

export interface CopilotStore {
  messages: Array<Record<string, unknown>>
  toolCallsById: Record<string, CopilotToolCall>
  activeStream: CopilotStreamInfo | null
  streamingPlanContent?: string
  handleNewChatCreation: (chatId: string) => Promise<void>
  updatePlanTodoStatus: (todoId: string, status: string) => void
  [key: string]: unknown
}

export type { ClientToolCallState, ClientToolDisplay }
