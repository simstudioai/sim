import type { ToolResponse } from '@/tools/types'

interface ZeliqBaseParams {
  apiKey: string
  callbackUrl: string
}

export interface ZeliqEnrichEmailParams extends ZeliqBaseParams {
  linkedinUrl?: string
  firstName?: string
  lastName?: string
  company?: string
  domain?: string
}

export interface ZeliqEnrichPhoneParams extends ZeliqBaseParams {
  linkedinUrl?: string
  email?: string
}

export interface ZeliqAsyncEnrichmentResponse extends ToolResponse {
  output: {
    status: number
    message: string
    jobId?: string
  }
}

export type ZeliqResponse = ZeliqAsyncEnrichmentResponse
