import {
  CREDENTIAL_GROUP_OAUTH_FAILURE_MESSAGES,
  type CredentialGroupOAuthFailure,
} from '@/lib/credential-groups/oauth-completion'
import type { CredentialGroupConnectionIntent } from '@/lib/credential-groups/oauth-intent'
import { CredentialGroupOAuthError } from '@/lib/credential-groups/provider-adapter'

interface ConnectedAccount {
  id: string
  revokedAt: Date | null
  managedOauthStatus: string | null
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
 * refresh or `undefined` to add one. Only an explicit add can grow the set. A managed MCP row or
 * identity may be unknown. A lone account still reconnects, as it always could, but nothing is added
 * beside an unknown account, since the two could be the same one. A disconnected unknown row is
 * reused so tool references pinned to its id keep working.
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
  const disconnectedUnidentified = accounts.find(
    (account) => account.revokedAt && account.providerSubjectId === null
  )

  if (intent?.kind === 'reconnect') {
    const target = accounts.find((account) => account.id === intent.credentialId)
    if (!target)
      throw new CredentialGroupOAuthError(
        'The account changed during authorization. Refresh your connections and try again.',
        409
      )
    if (identity) {
      if (existing ? existing.id !== target.id : target.providerSubjectId !== null)
        throw accountConflict('account_mismatch')
    } else if (
      target.providerSubjectId !== null &&
      live.some((account) => account.id !== target.id)
    ) {
      throw accountConflict('account_unverified')
    }
    if (target.revokedAt && live.length >= limit) throw accountConflict('account_limit_reached')
    return target
  }

  if (intent?.kind === 'create') {
    if (existing && !existing.revokedAt) {
      if (existing.managedOauthStatus === 'active')
        throw accountConflict('account_already_connected')
      return existing
    }
    if (live.length > 0 && !identity) throw accountConflict('account_unverified')
    if (hasUnidentifiedLive) throw accountConflict('account_identity_required')
    if (live.length >= limit) throw accountConflict('account_limit_reached')
    return existing ?? (live.length === 0 ? disconnectedUnidentified : undefined)
  }

  if (existing && !existing.revokedAt) return existing
  if (live.length === 0) return existing ?? disconnectedUnidentified
  if (live.length === 1 && !existing && (!identity || hasUnidentifiedLive)) return live[0]
  throw accountConflict(identity ? 'account_mismatch' : 'account_unverified')
}

const ACCOUNT_STATUS_RANK: Record<string, number> = { active: 2, needs_reauth: 1 }

/** The account that best represents a connection: usable, then fixable by reconnecting. */
export function moreUsableAccount<Account>(
  current: Account | undefined,
  candidate: Account,
  statusOf: (account: Account) => string | null
): Account {
  if (current === undefined) return candidate
  const rank = (account: Account) => ACCOUNT_STATUS_RANK[statusOf(account) ?? ''] ?? 0
  return rank(candidate) > rank(current) ? candidate : current
}
