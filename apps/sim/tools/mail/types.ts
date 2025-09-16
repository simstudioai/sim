import type { ToolResponse } from '@/tools/types'

export interface MailSendParams {
  to: string
  subject: string
  body: string
}

export interface MailSendResult extends ToolResponse {
  output: {
    success: boolean
    message: string
    data?: any
  }
}
