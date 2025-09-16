import type { ToolResponse } from '@/tools/types'

export interface MailSendParams {
  to: string
  subject: string
  body: string
}

export interface MailSendResult extends ToolResponse {
  output: {
    success: boolean
    to: string
    subject: string
    body: string
  }
}
