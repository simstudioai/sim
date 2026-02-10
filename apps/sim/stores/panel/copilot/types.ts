import type { CopilotMode, CopilotModelId } from '@/lib/copilot/models'
import type { AvailableModel } from '@/lib/copilot/types'

export type { CopilotMode, CopilotModelId } from '@/lib/copilot/models'

import type { ClientContentBlock } from '@/lib/copilot/client-sse/types'
import type { ClientToolCallState, ClientToolDisplay } from '@/lib/copilot/tools/client/base-tool'
import type { WorkflowState } from '@/stores/workflows/workflow/types'

export type ToolState = ClientToolCallState

/**
 * Subagent content block for nested thinking/reasoning inside a tool call
 */
export interface SubAgentContentBlock {
  type: 'subagent_text' | 'subagent_tool_call'
  content?: string
  toolCall?: CopilotToolCall
  timestamp: number
}

export interface CopilotToolCall {
  id: string
  name: string
  state: ClientToolCallState
  params?: Record<string, unknown>
  input?: Record<string, unknown>
  display?: ClientToolDisplay
  /** Content streamed from a subagent (e.g., debug agent) */
  subAgentContent?: string
  /** Tool calls made by the subagent */
  subAgentToolCalls?: CopilotToolCall[]
  /** Structured content blocks for subagent (thinking + tool calls in order) */
  subAgentBlocks?: SubAgentContentBlock[]
  /** Whether subagent is currently streaming */
  subAgentStreaming?: boolean
}

export interface CopilotStreamInfo {
  streamId: string
  workflowId: string
  chatId?: string
  userMessageId: string
  assistantMessageId: string
  lastEventId: number
  resumeAttempts: number
  userMessageContent: string
  fileAttachments?: MessageFileAttachment[]
  contexts?: ChatContext[]
  startedAt: number
}

export interface MessageFileAttachment {
  id: string
  key: string
  filename: string
  media_type: string
  size: number
}

export interface CopilotMessage {
  id: string
  role: 'user' | 'assistant' | 'system'
  content: string
  timestamp: string
  citations?: { id: number; title: string; url: string; similarity?: number }[]
  toolCalls?: CopilotToolCall[]
  contentBlocks?: ClientContentBlock[]
  fileAttachments?: MessageFileAttachment[]
  contexts?: ChatContext[]
  errorType?: 'usage_limit' | 'unauthorized' | 'forbidden' | 'rate_limit' | 'upgrade_required'
}

/**
 * A message queued for sending while another message is in progress.
 * Like Cursor's queued message feature.
 */
export interface QueuedMessage {
  id: string
  content: string
  fileAttachments?: MessageFileAttachment[]
  contexts?: ChatContext[]
  queuedAt: number
  /** Original messageId to use when processing (for edit/resend flows) */
  originalMessageId?: string
}

// Contexts attached to a user message
export type ChatContext =
  | { kind: 'past_chat'; chatId: string; label: string }
  | { kind: 'workflow'; workflowId: string; label: string }
  | { kind: 'current_workflow'; workflowId: string; label: string }
  | { kind: 'blocks'; blockIds: string[]; label: string }
  | { kind: 'logs'; executionId?: string; label: string }
  | { kind: 'workflow_block'; workflowId: string; blockId: string; label: string }
  | { kind: 'knowledge'; knowledgeId?: string; label: string }
  | { kind: 'templates'; templateId?: string; label: string }
  | { kind: 'docs'; label: string }
  | { kind: 'slash_command'; command: string; label: string }

import type { CopilotChat as ApiCopilotChat } from '@/lib/copilot/api'

export type CopilotChat = ApiCopilotChat

/**
 * A checkpoint entry as returned from the checkpoints API.
 */
export interface CheckpointEntry {
  id: string
  messageId?: string
  workflowState?: Record<string, unknown>
  createdAt?: string
}

export interface CopilotState {
  mode: CopilotMode
  selectedModel: CopilotModelId
  agentPrefetch: boolean
  enabledModels: string[] | null // Null means not loaded yet, array of model IDs when loaded
  availableModels: AvailableModel[]
  isLoadingModels: boolean
  isCollapsed: boolean

  currentChat: CopilotChat | null
  chats: CopilotChat[]
  messages: CopilotMessage[]
  workflowId: string | null

  messageCheckpoints: Record<string, CheckpointEntry[]>
  messageSnapshots: Record<string, WorkflowState>

  isLoading: boolean
  isLoadingChats: boolean
  isLoadingCheckpoints: boolean
  isSendingMessage: boolean
  isSaving: boolean
  isRevertingCheckpoint: boolean
  isAborting: boolean
  /** Skip adding Continue option on abort for queued send-now */
  suppressAbortContinueOption?: boolean

  error: string | null
  saveError: string | null
  checkpointError: string | null

  abortController: AbortController | null

  chatsLastLoadedAt: Date | null
  chatsLoadedForWorkflow: string | null

  revertState: { messageId: string; messageContent: string } | null
  inputValue: string

  planTodos: Array<{ id: string; content: string; completed?: boolean; executing?: boolean }>
  showPlanTodos: boolean

  // Streaming plan content from design_workflow tool (for plan mode section)
  streamingPlanContent: string

  // Map of toolCallId -> CopilotToolCall for quick access during streaming
  toolCallsById: Record<string, CopilotToolCall>

  // Transient flag to prevent auto-selecting a chat during new-chat UX
  suppressAutoSelect?: boolean

  // Explicitly track the current user message id for this in-flight query (for stats/diff correlation)
  currentUserMessageId?: string | null

  // Per-message metadata captured at send-time for reliable stats

  // Auto-allowed integration tools (tools that can run without confirmation)
  autoAllowedTools: string[]
  autoAllowedToolsLoaded: boolean

  // Active stream metadata for reconnect/replay
  activeStream: CopilotStreamInfo | null

  // Message queue for messages sent while another is in progress
  messageQueue: QueuedMessage[]

  // Credential IDs to mask in UI (for sensitive data protection)
  sensitiveCredentialIds: Set<string>
}

export interface CopilotActions {
  setMode: (mode: CopilotMode) => void
  setSelectedModel: (model: CopilotStore['selectedModel']) => Promise<void>
  setAgentPrefetch: (prefetch: boolean) => void
  setEnabledModels: (models: string[] | null) => void
  loadAvailableModels: () => Promise<void>

  setWorkflowId: (workflowId: string | null) => Promise<void>
  validateCurrentChat: () => boolean
  loadChats: (forceRefresh?: boolean) => Promise<void>
  selectChat: (chat: CopilotChat) => Promise<void>
  createNewChat: () => Promise<void>
  deleteChat: (chatId: string) => Promise<void>

  sendMessage: (
    message: string,
    options?: {
      stream?: boolean
      fileAttachments?: MessageFileAttachment[]
      contexts?: ChatContext[]
      messageId?: string
      queueIfBusy?: boolean
    }
  ) => Promise<void>
  abortMessage: (options?: { suppressContinueOption?: boolean }) => void
  sendImplicitFeedback: (
    implicitFeedback: string,
    toolCallState?: 'accepted' | 'rejected' | 'error'
  ) => Promise<void>
  updatePreviewToolCallState: (
    toolCallState: 'accepted' | 'rejected' | 'error',
    toolCallId?: string
  ) => void
  resumeActiveStream: () => Promise<boolean>
  setToolCallState: (toolCall: CopilotToolCall, newState: ClientToolCallState | string) => void
  updateToolCallParams: (toolCallId: string, params: Record<string, unknown>) => void
  loadMessageCheckpoints: (chatId: string) => Promise<void>
  revertToCheckpoint: (checkpointId: string) => Promise<void>
  getCheckpointsForMessage: (messageId: string) => CheckpointEntry[]
  saveMessageCheckpoint: (messageId: string) => Promise<boolean>

  clearMessages: () => void
  clearError: () => void
  clearSaveError: () => void
  clearCheckpointError: () => void
  cleanup: () => void
  reset: () => void

  setInputValue: (value: string) => void
  clearRevertState: () => void

  setPlanTodos: (
    todos: Array<{ id: string; content: string; completed?: boolean; executing?: boolean }>
  ) => void
  updatePlanTodoStatus: (id: string, status: 'executing' | 'completed') => void
  closePlanTodos: () => void
  clearPlanArtifact: () => Promise<void>
  savePlanArtifact: (content: string) => Promise<void>

  handleStreamingResponse: (
    stream: ReadableStream,
    messageId: string,
    isContinuation?: boolean,
    triggerUserMessageId?: string,
    abortSignal?: AbortSignal
  ) => Promise<void>
  handleNewChatCreation: (newChatId: string) => Promise<void>
  loadAutoAllowedTools: () => Promise<void>
  addAutoAllowedTool: (toolId: string) => Promise<void>
  removeAutoAllowedTool: (toolId: string) => Promise<void>
  isToolAutoAllowed: (toolId: string) => boolean

  // Credential masking
  loadSensitiveCredentialIds: () => Promise<void>
  maskCredentialValue: (value: string) => string

  // Message queue actions
  addToQueue: (
    message: string,
    options?: {
      fileAttachments?: MessageFileAttachment[]
      contexts?: ChatContext[]
      /** Original messageId to preserve (for edit/resend flows) */
      messageId?: string
    }
  ) => void
  removeFromQueue: (id: string) => void
  moveUpInQueue: (id: string) => void
  sendNow: (id: string) => Promise<void>
  clearQueue: () => void
}

export type CopilotStore = CopilotState & CopilotActions
