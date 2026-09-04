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
  return `*@${domain}`
}

/** The domain of a folded address; empty when the address has none. */
export function emailDomain(email: string): string {
  const at = email.lastIndexOf('@')
  return at === -1 ? '' : email.slice(at + 1)
}
