import type { CopilotToolCall } from '@/stores/panel/copilot/types'

export interface StreamingContext {
  messageId: string
  accumulatedContent: string
  contentBlocks: any[]
  currentTextBlock: any | null
  isInThinkingBlock: boolean
  currentThinkingBlock: any | null
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
  subAgentBlocks: Record<string, any[]>
  suppressStreamingUpdates?: boolean
}
