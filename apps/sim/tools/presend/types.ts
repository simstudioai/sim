import type { ToolResponse } from '@/tools/types'

/** Parameters for the Presend email verify tool. */
export interface PresendEmailVerifyParams {
  email: string
}

/** Response from the Presend email verify tool. */
export interface PresendEmailVerifyResponse extends ToolResponse {
  output: {
    email: string
    /** `null` when the address could not be checked (e.g. MX lookup failed); retry later. */
    valid: boolean | null
    syntaxValid: boolean
    domain: string
    /** `null` when the MX lookup itself failed. */
    mxFound: boolean | null
    mxCount: number
    disposable: boolean
    roleAccount: boolean
    /** One of `invalid_syntax`, `no_mx_record`, `disposable_domain`, `mx_lookup_failed`, or `null` when valid. */
    reason: string | null
  }
}
