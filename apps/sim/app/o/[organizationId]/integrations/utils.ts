import type { MemberIntegration } from '@/lib/credential-groups/member-integrations'

export function memberIntegrationStatus(entry: MemberIntegration) {
  if (entry.managed) return 'Organization managed'
  if (!entry.ready) return entry.description ?? 'Checking availability'
  if (
    entry.accounts.some(
      (account) =>
        account.status === 'needs_reauth' &&
        entry.reconnectAccountIds.includes(account.credentialId)
    )
  )
    return 'Reconnect needed'
  if (entry.accounts.length)
    return entry.accounts.length === 1 ? '1 account' : `${entry.accounts.length} accounts`
  return 'Not connected'
}
