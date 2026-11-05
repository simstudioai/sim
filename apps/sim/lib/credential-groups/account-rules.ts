import {
  CREDENTIAL_GROUP_OAUTH_FAILURE_MESSAGES,
  type CredentialGroupOAuthFailure,
} from '@/lib/credential-groups/oauth-completion'
import type { CredentialGroupConnectionIntent } from '@/lib/credential-groups/oauth-intent'
import { CredentialGroupOAuthError } from '@/lib/credential-groups/provider-adapter'

interface ConnectedAccount {
  id: string
  revokedAt: Date | null
  providerSubjectId: string | null
  providerTenantId: string | null
}

function accountConflict(failure: CredentialGroupOAuthFailure) {
  return new CredentialGroupOAuthError(
    CREDENTIAL_GROUP_OAUTH_FAILURE_MESSAGES[failure],
    409,
    undefined,
    failure
  )
}

/**
 * Applies what the member asked for to the account the provider verified, returning the row to
 * refresh or `undefined` to add one. A person adds accounts explicitly, so a reconnect or an
 * intentless invitation link never grows the set by itself. A managed MCP row or identity may be
 * unknown: that account can stay connected, but nothing else can be added beside it until it is
 * reconnected, since the two could be the same account.
 */
export function resolveAccountWrite<Account extends ConnectedAccount>({
  intent,
  limit,
  accounts,
  identity,
}: {
  intent?: CredentialGroupConnectionIntent
  limit: number
  accounts: Account[]
  identity: { subject: string; tenant: string | null } | null
}): Account | undefined {
  const existing = identity
    ? accounts.find(
        (account) =>
          account.providerSubjectId === identity.subject &&
          account.providerTenantId === identity.tenant
      )
    : undefined
  const live = accounts.filter((account) => !account.revokedAt)
  const hasUnidentifiedLive = live.some((account) => account.providerSubjectId === null)

  if (intent?.kind === 'reconnect') {
    const target = accounts.find((account) => account.id === intent.credentialId)
    if (!target)
      throw new CredentialGroupOAuthError(
        'The account changed during authorization. Refresh your connections and try again.',
        409
      )
    if (target.providerSubjectId === null) return target
    if (!identity) throw accountConflict('account_identity_required')
    if (existing?.id !== target.id) throw accountConflict('account_mismatch')
    return target
  }

  if (intent?.kind === 'create') {
    if (existing && !existing.revokedAt) throw accountConflict('account_already_connected')
    if (live.length > 0 && (!identity || hasUnidentifiedLive))
      throw accountConflict('account_identity_required')
    if (live.length >= limit) throw accountConflict('account_limit_reached')
    return (
      existing ??
      (identity ? undefined : accounts.find((account) => account.providerSubjectId === null))
    )
  }

  if (existing && !existing.revokedAt) return existing
  if (live.length === 0)
    return (
      existing ??
      (identity ? undefined : accounts.find((account) => account.providerSubjectId === null))
    )
  if (live.length === 1 && hasUnidentifiedLive) return live[0]
  throw accountConflict(identity ? 'account_mismatch' : 'account_identity_required')
}
