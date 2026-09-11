export type OAuthIdentityFailureReason =
  | 'email_mismatch'
  | 'email_access_denied'
  | 'provider_rejected'
  | 'rate_limited'
  | 'provider_unavailable'
  | 'invalid_response'

export type OAuthIdentityVerificationStage = 'token' | 'profile' | 'emails'

/** Carries safe diagnostics without retaining provider bodies, tokens, or email addresses. */
export class OAuthIdentityVerificationError extends Error {
  constructor(
    readonly reason: OAuthIdentityFailureReason,
    readonly stage: OAuthIdentityVerificationStage,
    readonly httpStatus?: number
  ) {
    super(`OAuth identity verification failed: ${reason}`)
    this.name = 'OAuthIdentityVerificationError'
  }
}
