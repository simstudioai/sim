import type { ChatContext, CopilotToolCall, SubAgentContentBlock } from '@/stores/panel/copilot/types'

/**
 * A content block used in copilot messages and during streaming.
 * Uses a literal type union for `type` to stay compatible with CopilotMessage.
 */
export type ContentBlockType = 'text' | 'thinking' | 'tool_call' | 'contexts'

export interface ClientContentBlock {
  type: ContentBlockType
  content?: string
  timestamp: number
  toolCall?: CopilotToolCall | null
  startTime?: number
  duration?: number
  contexts?: ChatContext[]
}

export interface StreamingContext {
  messageId: string
  accumulatedContent: string
  contentBlocks: ClientContentBlock[]
  currentTextBlock: ClientContentBlock | null
  isInThinkingBlock: boolean
  currentThinkingBlock: ClientContentBlock | null
  isInDesignWorkflowBlock: boolean
  designWorkflowContent: string
  pendingContent: string
  newChatId?: string
  doneEventCount: number
  streamComplete?: boolean
  wasAborted?: boolean
  suppressContinueOption?: boolean
  subAgentParentToolCallId?: string
  subAgentContent: Record<string, string>
  subAgentToolCalls: Record<string, CopilotToolCall[]>
  subAgentBlocks: Record<string, SubAgentContentBlock[]>
  suppressStreamingUpdates?: boolean
}

export type ClientStreamingContext = StreamingContext
