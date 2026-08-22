import type { ToolResponse } from '@/tools/types'

export interface PhotonImessageSendMessageParams {
  projectId: string
  projectSecret: string
  to?: string
  chatId?: string
  text: string
}

export interface PhotonImessageSendMessageResult extends ToolResponse {
  output: {
    messageId: string | null
    chatId: string
    timestamp: string | null
  }
}
