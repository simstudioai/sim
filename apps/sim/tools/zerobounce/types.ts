import type { ToolResponse } from '@/tools/types'

export interface ZeroBounceVerifyEmailParams {
  email: string
  apiKey: string
}

export interface ZeroBounceVerifyEmailResponse extends ToolResponse {
  output: {
    email: string
    status: string
    deliverable: boolean
    subStatus?: string
    freeEmail?: boolean
    didYouMean?: string
  }
}

export interface ZeroBounceGetCreditsParams {
  apiKey: string
}

export interface ZeroBounceGetCreditsResponse extends ToolResponse {
  output: {
    credits: number
  }
}

export type ZeroBounceResponse = ZeroBounceVerifyEmailResponse | ZeroBounceGetCreditsResponse
