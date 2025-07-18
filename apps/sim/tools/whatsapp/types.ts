import type { ToolResponse } from '../types'

export interface WhatsAppResponse extends ToolResponse {
  output: {
    success: boolean
    messageId?: string
    error?: string
  }
}
