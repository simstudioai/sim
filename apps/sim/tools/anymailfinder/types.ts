import type { ToolResponse } from '@/tools/types'

interface AnymailFinderBaseParams {
  apiKey: string
}

/**
 * Outcome of a find. `valid` is the only status that returns a deliverable
 * address (in `valid_email`) and the only one that is charged; `risky`
 * (an address that exists but could not be verified) is returned in `email`
 * only and is free; `not_found` and `blacklisted` are free misses.
 */
export type AnymailFinderEmailStatus = 'valid' | 'risky' | 'not_found' | 'blacklisted'

export type AnymailFinderVerificationStatus = 'valid' | 'invalid' | 'risky'

export interface AnymailFinderFindPersonEmailParams extends AnymailFinderBaseParams {
  full_name?: string
  domain?: string
  company_name?: string
  linkedin_url?: string
}

export interface AnymailFinderFindPersonEmailResponse extends ToolResponse {
  output: {
    email: string | null
    valid_email: string | null
    email_status: AnymailFinderEmailStatus
    mx_domain: string | null
    mx_host: string | null
    person_full_name: string | null
    person_company_name: string | null
    person_job_title: string | null
    credits_charged: number
  }
}

export interface AnymailFinderFindDecisionMakerEmailParams extends AnymailFinderBaseParams {
  domain?: string
  company_name?: string
  decision_maker_category: string[]
}

export interface AnymailFinderFindDecisionMakerEmailResponse extends ToolResponse {
  output: {
    email: string | null
    valid_email: string | null
    email_status: AnymailFinderEmailStatus
    decision_maker_category: string | null
    person_full_name: string | null
    person_first_name: string | null
    person_last_name: string | null
    person_job_title: string | null
    person_linkedin_url: string | null
    mx_domain: string | null
    mx_host: string | null
    credits_charged: number
  }
}

export interface AnymailFinderFindCompanyEmailsParams extends AnymailFinderBaseParams {
  domain?: string
  company_name?: string
  email_type?: 'any' | 'generic' | 'personal'
}

export interface AnymailFinderFindCompanyEmailsResponse extends ToolResponse {
  output: {
    emails: string[]
    valid_emails: string[]
    email_status: AnymailFinderEmailStatus
    mx_domain: string | null
    mx_host: string | null
    credits_charged: number
  }
}

export interface AnymailFinderVerifyEmailParams extends AnymailFinderBaseParams {
  email: string
}

export interface AnymailFinderVerifyEmailResponse extends ToolResponse {
  output: {
    email_status: AnymailFinderVerificationStatus
    mx_domain: string | null
    mx_host: string | null
    credits_charged: number
  }
}

export interface AnymailFinderGetAccountParams extends AnymailFinderBaseParams {}

export interface AnymailFinderGetAccountResponse extends ToolResponse {
  output: {
    credits_left: number
    account_email: string | null
  }
}

export type AnymailFinderResponse =
  | AnymailFinderFindPersonEmailResponse
  | AnymailFinderFindDecisionMakerEmailResponse
  | AnymailFinderFindCompanyEmailsResponse
  | AnymailFinderVerifyEmailResponse
  | AnymailFinderGetAccountResponse
