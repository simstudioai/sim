import type { OutputProperty, ToolResponse } from '@/tools/types'

/** Common params shared by all Enrow tool operations. */
export interface EnrowBaseParams {
  apiKey: string
}

// ---------------------------------------------------------------------------
// Email Finder — single
// ---------------------------------------------------------------------------

export interface EnrowFindEmailParams extends EnrowBaseParams {
  fullname: string
  company_domain?: string
  company_name?: string
}

export interface EnrowFindEmailResult {
  /** Job ID returned by the submit call; used to poll for the result. */
  id: string
  email: string | null
  /** Enrow quality qualifier: "valid" | "invalid" | null (if not yet finished). */
  qualification: string | null
  fullname: string | null
  company_name: string | null
  company_domain: string | null
  linkedin_url: string | null
}

export interface EnrowFindEmailResponse extends ToolResponse {
  output: EnrowFindEmailResult
}

// ---------------------------------------------------------------------------
// Email Verifier — single
// ---------------------------------------------------------------------------

export interface EnrowVerifyEmailParams extends EnrowBaseParams {
  email: string
}

export interface EnrowVerifyEmailResult {
  /** Job ID returned by the submit call; used to poll for the result. */
  id: string
  email: string | null
  /** Enrow quality qualifier: "valid" | "invalid" | null (if not yet finished). */
  qualification: string | null
}

export interface EnrowVerifyEmailResponse extends ToolResponse {
  output: EnrowVerifyEmailResult
}

// ---------------------------------------------------------------------------
// Union response type (used in BlockConfig generic)
// ---------------------------------------------------------------------------

export type EnrowResponse = EnrowFindEmailResponse | EnrowVerifyEmailResponse

// ---------------------------------------------------------------------------
// Shared output property constants
// ---------------------------------------------------------------------------

/** Reusable output-property definition for the Enrow job ID. */
export const ENROW_ID_OUTPUT: OutputProperty = {
  type: 'string',
  description: 'Enrow job identifier used for polling',
}

/** Reusable output-property definition for the returned email address. */
export const ENROW_EMAIL_OUTPUT: OutputProperty = {
  type: 'string',
  description: 'Email address found or verified',
  optional: true,
}

/** Reusable output-property definition for the qualification field. */
export const ENROW_QUALIFICATION_OUTPUT: OutputProperty = {
  type: 'string',
  description: 'Enrow quality result: "valid" or "invalid"',
  optional: true,
}
