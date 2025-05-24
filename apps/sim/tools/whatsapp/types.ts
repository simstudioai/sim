import type { ToolResponse } from '../types'

export interface WhatsAppToolResponse extends ToolResponse {
  output: {
    success: boolean
    messageId?: string
    error?: string
  }
}
