import { isValidUuid } from '@sim/utils/id'

export const CREDENTIAL_GROUP_OAUTH_FAILURE_MESSAGES = {
  expired: 'This connection attempt expired. Try connecting your account again.',
  denied: 'Authorization was canceled. Try connecting your account again.',
  account_mismatch: 'Choose the account matching your Sim email address.',
  github_email_mismatch:
    'In GitHub Settings → Emails, add and verify the email address used for this Sim connection, then try again. A verified secondary email is supported.',
  github_email_access_denied:
    'GitHub did not allow access to your email addresses. Ask an admin to check that the GitHub App has Email addresses: Read-only permission, then authorize the app again.',
  permissions_required: 'All requested permissions are required to connect this account.',
  configuration_changed: 'The connection settings changed. Try connecting your account again.',
  rate_limited: 'Authorization is being rate limited. Wait a few minutes and try again.',
  provider_unavailable:
    'The account provider could not verify your account right now. Try connecting again in a few minutes.',
  unavailable: 'This connection is unavailable. Try connecting your account again.',
  failed: 'Account authorization did not complete. Try connecting your account again.',
} as const

export type CredentialGroupOAuthFailure = keyof typeof CREDENTIAL_GROUP_OAUTH_FAILURE_MESSAGES

/** Correlation only: completion notifications trigger authoritative query refreshes, never grants. */
export function credentialGroupOAuthCompletionChannel(completionId: string): string {
  if (!isValidUuid(completionId)) throw new Error('Invalid OAuth completion ID')
  return `sim:credential-group-oauth:${completionId}`
}

export function isCredentialGroupOAuthFailure(
  value: unknown
): value is CredentialGroupOAuthFailure {
  return typeof value === 'string' && Object.hasOwn(CREDENTIAL_GROUP_OAUTH_FAILURE_MESSAGES, value)
}
