import type { BrowserKnownSession } from '@sim/browser-protocol'
import type { BrowserCredentialMetadata, BrowserSiteInfo } from '@sim/desktop-bridge'
import { fuzzyMatch } from '@/app/workspace/[workspaceId]/w/components/sidebar/components/search-modal/utils'

/** Rows the omnibox will show at once. */
export const MAX_URL_SUGGESTIONS = 8

/**
 * How well the browser knows a host, strongest first. Ordering the corpus by
 * this before recency is what keeps a lightly-used imported site from
 * outranking somewhere the user actually has an account, and it is why
 * imported hosts can be offered at all without drowning the real ones.
 */
export const SUGGESTION_TIER = {
  /** A saved password, or an agent sign-in this browser completed. */
  ACCOUNT: 2,
  /** Visited in this browser and still holding a cookie. */
  ACTIVE: 1,
  /** Known only from another browser the user imported. */
  IMPORTED: 0,
} as const

export type SuggestionTier = (typeof SUGGESTION_TIER)[keyof typeof SUGGESTION_TIER]

export interface UrlSuggestion {
  hostname: string
  /** Where selecting the row navigates. */
  url: string
  /**
   * What the site calls itself, learned from the source browser at import
   * time. Absent for a host that was never named there.
   */
  name?: string
  /** Imported favicon as a data URL, when the source browser had one. */
  icon?: string
  /** Epoch ms of the most recent evidence, used to break ties by recency. */
  lastSeenAt: number
  /** @see SUGGESTION_TIER */
  tier: SuggestionTier
  /**
   * Source-browser visit count, for hosts that came from an import. Orders the
   * imported tier by how much the user actually uses each site, which is the
   * only usage signal that exists for a host this browser has never seen.
   */
  visits?: number
}

function timestamp(value: string | undefined): number {
  if (!value) return 0
  const parsed = Date.parse(value)
  return Number.isNaN(parsed) ? 0 : parsed
}

/**
 * The hostname a credential's origin refers to.
 *
 * Origins are stored as exact origins, but a malformed one must not take the
 * whole omnibox down, so anything unparseable is simply not suggested.
 */
function hostnameOf(origin: string): string | null {
  try {
    const { hostname } = new URL(origin)
    return hostname || null
  } catch {
    return null
  }
}

/**
 * Builds the omnibox's corpus from what the browser already knows.
 *
 * Three sources, each of which exists for a reason of its own: hosts with a
 * saved password, hosts this browser has been to that still hold a cookie, and
 * hosts brought over from the browser the user imported from. None of them is
 * a log of where this browser has been — it keeps no history, and an agent
 * drives it, so a visit log would blend the agent's browsing into the user's
 * suggestions and the user's into the agent's reach.
 *
 * The imported source is the reason the list is not almost empty on a fresh
 * install, and it is admitted at the weakest tier: hosts nobody has signed into
 * here can be offered without displacing the ones somebody has. A host found in
 * more than one source appears once, at its strongest tier, keeping whichever
 * favicon and whichever timestamp is the more useful of the two.
 */
export function mergeSuggestionSources(
  sessions: readonly BrowserKnownSession[],
  credentials: readonly BrowserCredentialMetadata[],
  sites: readonly BrowserSiteInfo[] = []
): UrlSuggestion[] {
  const byHostname = new Map<string, UrlSuggestion>()
  const known = new Map(sites.map((site) => [site.hostname, site]))

  const record = (hostname: string, tier: SuggestionTier, seenAt: number, icon?: string) => {
    const existing = byHostname.get(hostname)
    if (existing) {
      if (tier > existing.tier) existing.tier = tier
      existing.icon ??= icon
      existing.lastSeenAt = Math.max(existing.lastSeenAt, seenAt)
      return
    }
    const site = known.get(hostname)
    byHostname.set(hostname, {
      hostname,
      url: `https://${hostname}`,
      name: site?.name,
      icon: icon ?? site?.icon,
      lastSeenAt: seenAt,
      tier,
    })
  }

  for (const credential of credentials) {
    const hostname = hostnameOf(credential.origin)
    if (!hostname) continue
    record(
      hostname,
      SUGGESTION_TIER.ACCOUNT,
      Math.max(timestamp(credential.updatedAt), timestamp(credential.createdAt)),
      credential.icon
    )
  }

  for (const session of sessions) {
    if (!session.hostname) continue
    record(
      session.hostname,
      session.evidence === 'sign-in-completed' ? SUGGESTION_TIER.ACCOUNT : SUGGESTION_TIER.ACTIVE,
      timestamp(session.lastObservedAt)
    )
  }

  // Last, so a host with real evidence keeps the tier and timestamp that
  // evidence earned it rather than being flattened to the moment of the import.
  for (const site of sites) {
    if (!site.hostname || byHostname.has(site.hostname)) continue
    byHostname.set(site.hostname, {
      hostname: site.hostname,
      url: `https://${site.hostname}`,
      name: site.name,
      icon: site.icon,
      lastSeenAt: timestamp(site.importedAt),
      tier: SUGGESTION_TIER.IMPORTED,
      visits: site.visits,
    })
  }

  return [...byHostname.values()]
}

/**
 * Orders the corpus for what the user has typed so far.
 *
 * An empty query lists the best-known hosts, which makes focusing the omnibox
 * a shortcut to where you usually go. Otherwise the palette's matcher ranks
 * them: its word-boundary bonuses already treat `.` and `/` as separators, so
 * `git.co` reaching `github.com` falls out of the existing scoring rather than
 * needing URL-specific rules, and typing a bare label like `ycombinator` finds
 * the host it belongs to. A host also answers to the name its own browser gave
 * it — see {@link searchTermsFor} — scored by whichever name fits best.
 * {@link byConfidence} breaks ties so equally good matches come back in a
 * stable order.
 */
export function rankSuggestions(
  suggestions: readonly UrlSuggestion[],
  query: string,
  limit: number = MAX_URL_SUGGESTIONS
): UrlSuggestion[] {
  const trimmed = query.trim()

  if (!trimmed) {
    return [...suggestions].sort(byConfidence).slice(0, limit)
  }

  const scored: Array<{ suggestion: UrlSuggestion; score: number }> = []
  for (const suggestion of suggestions) {
    const { matched, score } = bestMatch(suggestion, trimmed)
    if (matched) scored.push({ suggestion, score })
  }
  scored.sort((a, b) => b.score - a.score || byConfidence(a.suggestion, b.suggestion))
  return scored.slice(0, limit).map((entry) => entry.suggestion)
}

/**
 * How well the browser knows a host, then how much it is used, then how
 * recently, then alphabetically so the same corpus always comes back in the
 * same order.
 *
 * Tier has to lead. Every host from one import shares that import's timestamp,
 * which is by definition the newest thing in the corpus, so ordering on recency
 * alone would put a site the user has never signed into above the one they use
 * daily. Within the imported tier those timestamps are all equal and the source
 * browser's own usage is what remains to tell them apart.
 */
function byConfidence(first: UrlSuggestion, second: UrlSuggestion): number {
  return (
    second.tier - first.tier ||
    (second.visits ?? 0) - (first.visits ?? 0) ||
    second.lastSeenAt - first.lastSeenAt ||
    first.hostname.localeCompare(second.hostname)
  )
}

/**
 * Everything a host can be found by: its hostname, and whatever the site
 * calls itself.
 *
 * The name is why typing "gmail" reaches `mail.google.com`, which its hostname
 * never spells out. It is not a list of well-known sites kept in this file —
 * it comes from the titles in the browser the user imported from, so it is
 * their own sites, named the way their own browser named them.
 */
export function searchTermsFor(suggestion: UrlSuggestion): readonly string[] {
  return suggestion.name ? [suggestion.hostname, suggestion.name] : [suggestion.hostname]
}

/** The best score any of a host's names earns for this query. */
function bestMatch(suggestion: UrlSuggestion, query: string): { matched: boolean; score: number } {
  let best = { matched: false, score: 0 }
  for (const term of searchTermsFor(suggestion)) {
    const candidate = fuzzyMatch(term, query)
    if (candidate.matched && (!best.matched || candidate.score > best.score)) {
      best = { matched: true, score: candidate.score }
    }
  }
  return best
}

/**
 * Where the arrow keys land next.
 *
 * Nothing is highlighted until the user actually arrows into the list, so
 * Enter keeps meaning "go to what I typed" rather than silently redirecting to
 * a suggestion. Both ends wrap, and Up from that neutral state enters at the
 * bottom.
 */
export function moveActiveIndex(
  current: number | null,
  delta: number,
  count: number
): number | null {
  if (count <= 0) return null
  if (current === null) return delta > 0 ? 0 : count - 1
  const next = current + delta
  if (next < 0) return count - 1
  if (next >= count) return 0
  return next
}
