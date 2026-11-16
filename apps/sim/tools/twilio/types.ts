import type { ToolResponse } from '@/tools/types'

export interface TwilioSendSMSParams {
  phoneNumbers: string
  message: string
  accountSid: string
  authToken: string
  fromNumber?: string
  messagingServiceSid?: string
}

export interface TwilioSMSBlockOutput extends ToolResponse {
  output: {
    success: boolean
    messageId?: string
    status?: string
    fromNumber?: string | null
    toNumber?: string | null
    error?: string
  }
}
