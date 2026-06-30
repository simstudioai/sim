import type { OutputProperty, ToolResponse } from '@/tools/types'

/** Base params shared by every Icypeas operation. */
export interface IcypeasBaseParams {
  apiKey: string
}

// ---------------------------------------------------------------------------
// Email Finder (single email discovery)
// ---------------------------------------------------------------------------

export interface IcypeasFindEmailParams extends IcypeasBaseParams {
  firstname?: string
  lastname?: string
  domainOrCompany: string
}

export interface IcypeasFindEmailOutput {
  /** Icypeas internal search ID used to poll the result. */
  searchId: string | null
  status: string | null
  email: string | null
  firstname: string | null
  lastname: string | null
  /** Raw item object from the results endpoint. */
  item: Record<string, unknown> | null
}

export interface IcypeasFindEmailResponse extends ToolResponse {
  output: IcypeasFindEmailOutput
}

// ---------------------------------------------------------------------------
// Email Verification
// ---------------------------------------------------------------------------

export interface IcypeasVerifyEmailParams extends IcypeasBaseParams {
  email: string
}

export interface IcypeasVerifyEmailOutput {
  /** Icypeas internal search ID used to poll the result. */
  searchId: string | null
  status: string | null
  email: string | null
  /** Whether the email is valid/found. Derived from terminal status. */
  valid: boolean | null
  /** Raw item object from the results endpoint. */
  item: Record<string, unknown> | null
}

export interface IcypeasVerifyEmailResponse extends ToolResponse {
  output: IcypeasVerifyEmailOutput
}

// ---------------------------------------------------------------------------
// Union response type used by the block
// ---------------------------------------------------------------------------

export type IcypeasResponse = IcypeasFindEmailResponse | IcypeasVerifyEmailResponse

// ---------------------------------------------------------------------------
// Shared output property constants
// ---------------------------------------------------------------------------

export const ICYPEAS_SEARCH_ID_OUTPUT: OutputProperty = {
  type: 'string',
  description: 'Icypeas internal search ID',
  optional: true,
}

export const ICYPEAS_STATUS_OUTPUT: OutputProperty = {
  type: 'string',
  description:
    'Terminal search status: FOUND | DEBITED | NOT_FOUND | DEBITED_NOT_FOUND | BAD_INPUT | INSUFFICIENT_FUNDS | ABORTED',
  optional: true,
}

export const ICYPEAS_EMAIL_OUTPUT: OutputProperty = {
  type: 'string',
  description: 'Email address found or verified',
  optional: true,
}

export const ICYPEAS_ITEM_OUTPUT: OutputProperty = {
  type: 'json',
  description: 'Full raw item object returned by the Icypeas results endpoint',
  optional: true,
}
