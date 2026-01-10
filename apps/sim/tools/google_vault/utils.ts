/**
 * Google Vault Error Enhancement Utilities
 *
 * Provides user-friendly error messages for common Google Vault authentication
 * and credential issues, particularly RAPT (reauthentication policy) errors.
 */

/**
 * Detects if an error message indicates a credential/reauthentication issue
 */
function isCredentialRefreshError(errorMessage: string): boolean {
  const lowerMessage = errorMessage.toLowerCase()
  return (
    lowerMessage.includes('invalid_rapt') ||
    lowerMessage.includes('reauth related error') ||
    (lowerMessage.includes('invalid_grant') && lowerMessage.includes('rapt')) ||
    lowerMessage.includes('failed to refresh token') ||
    (lowerMessage.includes('failed to fetch access token') && lowerMessage.includes('401'))
  )
}

/**
 * Enhances Google Vault error messages with actionable guidance
 *
 * For credential/reauthentication errors (RAPT errors), provides specific
 * instructions for resolving the issue through Google Admin Console settings.
 */
export function enhanceGoogleVaultError(errorMessage: string): string {
  if (isCredentialRefreshError(errorMessage)) {
    return (
      `Google Vault authentication failed (likely due to reauthentication policy). ` +
      `To resolve this, try disconnecting and reconnecting your Google Vault credential ` +
      `in the Credentials settings. If the issue persists, ask your Google Workspace ` +
      `administrator to disable "Reauthentication policy" for Sim Studio in the Google ` +
      `Admin Console (Security > Access and data control > Context-Aware Access > ` +
      `Reauthentication policy), or exempt Sim Studio from reauthentication requirements. ` +
      `Learn more: https://support.google.com/a/answer/9368756`
    )
  }
  return errorMessage
}
