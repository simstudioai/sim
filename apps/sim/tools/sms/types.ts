import type { ToolResponse } from '@/tools/types'

export interface SMSSendParams {
  to: string
  body: string
}

export interface SMSSendResult extends ToolResponse {
  output: {
    success: boolean
    to: string
    body: string
  }
}
