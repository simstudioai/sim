import type { OutputProperty, ToolResponse } from '@/tools/types'

export interface KittBaseParams {
  apiKey: string
  customData?: string
}

export interface KittFindEmailParams extends KittBaseParams {
  fullName: string
  domain: string
  linkedinStandardProfileURL?: string
  strictNameMatches?: boolean
}

export type KittFindEmailOutcome = 'success' | 'no-results-found'

export interface KittFindEmailOutput {
  outcome: KittFindEmailOutcome
  email: string | null
}

export interface KittFindEmailResponse extends ToolResponse {
  output: KittFindEmailOutput
}

export interface KittVerifyEmailParams extends KittBaseParams {
  email: string
  treatAliasesAsValid?: boolean
}

export type KittVerifyEmailOutcome = 'valid' | 'valid-risky' | 'invalid' | 'unknown'

export interface KittVerifyEmailOutput {
  outcome: KittVerifyEmailOutcome
  email: string
}

export interface KittVerifyEmailResponse extends ToolResponse {
  output: KittVerifyEmailOutput
}

export type KittResponse = KittFindEmailResponse | KittVerifyEmailResponse

export const KITT_OUTCOME_OUTPUT: OutputProperty = {
  type: 'string',
  description:
    'Kitt result outcome: success or no-results-found for finding; valid, valid-risky, invalid, or unknown for verification',
}

export const KITT_EMAIL_OUTPUT: OutputProperty = {
  type: 'string',
  description: 'Email address found or verified',
  optional: true,
  nullable: true,
}
