import { isValidUuid } from '@sim/utils/id'

export const CREDENTIAL_GROUP_OAUTH_FAILURE_MESSAGES = {
  expired: 'This connection attempt expired. Try connecting your account again.',
  denied: 'Authorization was canceled. Try connecting your account again.',
  account_mismatch: 'Choose the account matching your Sim email address.',
  permissions_required: 'All requested permissions are required to connect this account.',
  configuration_changed: 'The connection settings changed. Try connecting your account again.',
  rate_limited: 'Too many authorization attempts. Wait a few minutes and try again.',
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
