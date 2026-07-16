import { truncate } from '@sim/utils/string'

const MAX_DESCRIPTION_LENGTH = 300

function buildSafeMessage(
  providerId: string,
  errorCode?: string,
  errorDescription?: string
): string {
  const code = errorCode || 'unknown_error'
  return errorDescription
    ? `${code} (${providerId}: ${truncate(errorDescription, MAX_DESCRIPTION_LENGTH)})`
    : `${code} (${providerId})`
}

/**
 * A token-refresh failure with the provider's error preserved. The message is
 * built from the provider error code and (truncated) error description only —
 * never raw response bodies — so it is safe to surface to end users.
 */
export class OAuthRefreshError extends Error {
  constructor(
    readonly providerId: string,
    readonly errorCode?: string,
    errorDescription?: string
  ) {
    super(buildSafeMessage(providerId, errorCode, errorDescription))
    this.name = 'OAuthRefreshError'
  }
}
