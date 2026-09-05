/**
 * How long a mirrored directory group keeps granting access after its
 * membership was last confirmed.
 *
 * The directory sync never overwrites a membership it failed to read in full,
 * so a transient outage revokes nobody — which is the behaviour we want, and is
 * exactly why an age bound is required. Without one, a sync that stopped
 * running altogether would keep granting indefinitely from membership nobody
 * has checked since.
 *
 * A day is deliberately generous against the sync's own cadence, so a cron
 * outage or a rate-limited directory has room to recover before anyone loses
 * access, while a genuinely abandoned sync stops granting within a day.
 */
export const EXTERNAL_GROUP_STALE_AFTER_MS = 24 * 60 * 60 * 1000

/**
 * How often a workspace's directory groups are re-enumerated.
 *
 * Permissions move faster than content and cost far less to read, so they sync
 * on their own clock rather than riding the content sync. One interval for
 * every provider: the directories mirrored so far are all cheap to list, and a
 * per-provider cadence is a knob nothing has needed yet.
 */
export const EXTERNAL_GROUP_SYNC_INTERVAL_MS = 5 * 60 * 1000

/** A domain as tokens and group rows spell it. */
export function normalizeDomain(domain: string): string {
  return domain.trim().toLowerCase()
}

const DOMAIN_GROUP_PREFIX = 'domain:'

/**
 * The synthetic group standing for "everyone in this domain".
 *
 * A domain share is an ordinary group grant at the read side: one token
 * shape, and membership decided by {@link domainMemberWildcard} rather than by
 * a second predicate. The prefix cannot collide with a real group, whose id
 * is an address or an opaque id, never a bare `domain:` label.
 */
export function domainGroupId(domain: string): string {
  return `${DOMAIN_GROUP_PREFIX}${normalizeDomain(domain)}`
}

/** The domain a synthetic domain group stands for, or null for a real group. */
export function domainOfGroupId(groupId: string): string | null {
  if (!groupId.startsWith(DOMAIN_GROUP_PREFIX)) return null
  return groupId.slice(DOMAIN_GROUP_PREFIX.length) || null
}

/**
 * The member row standing for everyone whose address is on a domain.
 *
 * A source can grant to "everyone at corp.com" — a Drive domain share, a
 * Workspace group whose member is the whole customer — and nobody wants to
 * enumerate a company to store that. The group is stored with one member, this
 * wildcard, and a reader matches it by their own address's domain. A real
 * address can never look like it: no provider issues a local part of `*`.
 */
export function domainMemberWildcard(domain: string): string {
  return `u:*@${normalizeDomain(domain)}`
}

/** The domain of a folded address; empty when the address has none. */
export function emailDomain(email: string): string {
  const at = email.lastIndexOf('@')
  return at === -1 ? '' : email.slice(at + 1)
}
