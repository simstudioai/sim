import type { ToolResponse } from '../types'

export interface WhatsAppSendMessageParams {
  phoneNumber: string
  message: string
  phoneNumberId: string
  accessToken: string
}

export interface WhatsAppResponse extends ToolResponse {
  output: {
    success: boolean
    messageId?: string
    error?: string
  }
}
