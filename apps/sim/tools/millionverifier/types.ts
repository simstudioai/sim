import type { ToolResponse } from '@/tools/types'

export interface MillionVerifierVerifyEmailParams {
  email: string
  apiKey: string
}

export interface MillionVerifierVerifyEmailResponse extends ToolResponse {
  output: {
    email: string
    status: string
    deliverable: boolean
    freeEmail?: boolean
    roleAccount?: boolean
    didYouMean?: string
    subResult?: string
  }
}

export interface MillionVerifierGetCreditsParams {
  apiKey: string
}

export interface MillionVerifierGetCreditsResponse extends ToolResponse {
  output: {
    credits: number
  }
}

export type MillionVerifierResponse =
  | MillionVerifierVerifyEmailResponse
  | MillionVerifierGetCreditsResponse
