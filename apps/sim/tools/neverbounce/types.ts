import type { ToolResponse } from '@/tools/types'

export interface NeverBounceVerifyEmailParams {
  email: string
  apiKey: string
}

export interface NeverBounceVerifyEmailResponse extends ToolResponse {
  output: {
    email: string
    status: string
    deliverable: boolean
    roleAccount?: boolean
    freeEmail?: boolean
    didYouMean?: string
    flags?: string[]
  }
}

export interface NeverBounceGetCreditsParams {
  apiKey: string
}

export interface NeverBounceGetCreditsResponse extends ToolResponse {
  output: {
    credits: number
    freeCredits: number
  }
}

export type NeverBounceResponse = NeverBounceVerifyEmailResponse | NeverBounceGetCreditsResponse
