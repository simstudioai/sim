// Common types for Presend tools
import type { ToolResponse } from '@/tools/types'

// Email Verify tool types
export interface PresendEmailVerifyParams {
  email: string
}

export interface PresendEmailVerifyResponse extends ToolResponse {
  output: {
    email: string
    valid: boolean
    syntaxValid: boolean
    domain: string
    mxFound: boolean
    mxCount: number
    disposable: boolean
    roleAccount: boolean
    reason: string
  }
}
