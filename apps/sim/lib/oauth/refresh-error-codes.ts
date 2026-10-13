/**
 * Refresh error codes that say the credential itself is gone: its grant was revoked, expired, or
 * rotated out, and only its owner reconnecting restores it.
 */
const CREDENTIAL_REVOCATION_ERRORS = new Set<string>([
  'invalid_refresh_token',
  'bad_refresh_token',
  'invalid_grant',
  'access_denied',
  'token_revoked',
])

/**
 * Refresh error codes that say our app registration is misconfigured (a rotated client secret,
 * a wrong client id or redirect URI). No retry recovers them either, but the fault is ours and a
 * configuration fix restores every credential of the provider without its owner doing anything.
 */
const APP_CONFIGURATION_ERRORS = new Set<string>([
  'bad_client_secret',
  'invalid_client_id',
  'invalid_client',
  'bad_redirect_uri',
])

/**
 * Credential revocation codes only for the providers listed. Atlassian rejects a revoked or
 * rotated-out refresh token with `unauthorized_client`; elsewhere that code usually describes the
 * app registration, and treating it as terminal would send every credential of the provider to
 * reauthorization over one configuration fault.
 */
const PROVIDER_CREDENTIAL_REVOCATION_ERRORS: ReadonlyMap<string, ReadonlySet<string>> = new Map([
  ['confluence', new Set(['unauthorized_client'])],
  ['jira', new Set(['unauthorized_client'])],
])

/**
 * Whether a refresh error code means the credential's own grant is gone, so that only its owner
 * reconnecting restores it. App-registration faults are terminal for a refresh but not a
 * revocation: fixing the configuration restores the credential with no action from its owner.
 */
export function isCredentialRevocationError(
  code: string | undefined | null,
  providerId?: string
): boolean {
  if (!code) return false
  if (CREDENTIAL_REVOCATION_ERRORS.has(code)) return true
  return (
    providerId !== undefined &&
    (PROVIDER_CREDENTIAL_REVOCATION_ERRORS.get(providerId)?.has(code) ?? false)
  )
}

/** Whether no retry of a refresh can recover from the error code, whoever's fault it is. */
export function isTerminalRefreshError(
  code: string | undefined | null,
  providerId?: string
): boolean {
  if (!code) return false
  return APP_CONFIGURATION_ERRORS.has(code) || isCredentialRevocationError(code, providerId)
}
