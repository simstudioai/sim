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
   * Source-browser visit count, carried over for every host the import knows —
   * not only the ones admitted at {@link SUGGESTION_TIER.IMPORTED}. A host with
   * a saved password is usually in the import too, and its visit count is the
   * only signal that separates it from the rest of its tier once
   * {@link byConfidence} runs out of timestamps to compare.
   */
  visits?: number
}

export type OmniboxSuggestion =
  | ({ kind: 'site' } & UrlSuggestion)
  | { kind: 'search'; query: string; url: string }

const HOST_LIKE_INPUT =
  /^([a-z0-9-]+(\.[a-z0-9-]+)+|localhost|\d{1,3}(\.\d{1,3}){3}|\[[0-9a-f:]+\])(:\d+)?([/?#].*)?$/i

/** Whether an omnibox value should search rather than navigate directly. */
export function isSearchQueryInput(raw: string): boolean {
  const input = raw.trim()
  if (!input || /^https?:\/\//i.test(input)) return false
  return input.includes(' ') || !HOST_LIKE_INPUT.test(input)
}

/** The canonical Google results URL used by search rows and bare submission. */
export function googleSearchUrl(query: string): string {
  return `https://www.google.com/search?q=${encodeURIComponent(query.trim())}`
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
 * Two sources admit a host: a top-level visit in this browser that still has
 * session evidence, or positive aggregate visit evidence imported from the
 * user's other browser. Saved credentials can promote and decorate an admitted
 * host, but cannot create a suggestion by themselves: owning a password is not
 * evidence that someone chose to visit the site.
 *
 * This remains an aggregate directory rather than a history log: no page URL,
 * visit timestamp, or sequence is retained. A host found in more than one
 * source appears once, at its strongest tier, keeping whichever favicon and
 * whichever timestamp is the more useful of the two.
 */
export function mergeSuggestionSources(
  sessions: readonly BrowserKnownSession[],
  credentials: readonly BrowserCredentialMetadata[],
  sites: readonly BrowserSiteInfo[] = []
): UrlSuggestion[] {
  const byHostname = new Map<string, UrlSuggestion>()
  const known = new Map(sites.map((site) => [site.hostname, site]))
  const visitedHosts = new Set(sessions.map((session) => session.hostname))
  for (const site of sites) {
    if (typeof site.visits === 'number' && Number.isFinite(site.visits) && site.visits > 0) {
      visitedHosts.add(site.hostname)
    }
  }

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
      visits: site?.visits,
    })
  }

  for (const credential of credentials) {
    const hostname = hostnameOf(credential.origin)
    if (!hostname || !visitedHosts.has(hostname)) continue
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
    if (!site.hostname || !visitedHosts.has(site.hostname) || byHostname.has(site.hostname)) {
      continue
    }
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
 * Combines immediate navigation/search actions with the user's known sites and
 * live completions. The exact typed search leads, known sites retain priority,
 * and remote completions fill whatever room remains.
 */
export function buildOmniboxSuggestions(
  siteCorpus: readonly UrlSuggestion[],
  rawQuery: string,
  searchCompletions: readonly string[] = [],
  limit: number = MAX_URL_SUGGESTIONS
): OmniboxSuggestion[] {
  if (limit <= 0) return []
  const query = rawQuery.trim()
  const sites = rankSuggestions(siteCorpus, query, limit)
  if (!query || !isSearchQueryInput(query)) {
    return sites.map((site) => ({ ...site, kind: 'site' }))
  }

  const results: OmniboxSuggestion[] = [{ kind: 'search', query, url: googleSearchUrl(query) }]
  for (const site of sites) {
    if (results.length === limit) return results
    results.push({ ...site, kind: 'site' })
  }

  const seen = new Set([query.toLocaleLowerCase()])
  for (const candidate of searchCompletions) {
    const completion = candidate.trim()
    const key = completion.toLocaleLowerCase()
    if (!completion || seen.has(key)) continue
    seen.add(key)
    results.push({ kind: 'search', query: completion, url: googleSearchUrl(completion) })
    if (results.length === limit) break
  }
  return results
}

/**
 * How well the browser knows a host, then how much it is used, then how
 * recently, then alphabetically so the same corpus always comes back in the
 * same order.
 *
 * Tier has to lead. Every host from one import shares that import's timestamp,
 * which is by definition the newest thing in the corpus, so ordering on recency
 * alone would put a site the user has never signed into above the one they use
 * daily.
 *
 * Visits then has to outrank recency, because one import flattens the
 * timestamps of every tier it touches, not just the imported one: a password
 * import stamps all of its credentials with the same instant, so the whole
 * account tier ties on recency and would fall through to the alphabetical
 * tiebreak below. That is why {@link mergeSuggestionSources} carries `visits`
 * onto credentialed hosts as well — without it this comparator has nothing
 * left, and the omnibox opens on whichever eight hosts sort first by name.
 *
 * A credentialed host the import has never heard of counts as zero visits and
 * so sits below one it has. That is deliberate: keeping every step of the chain
 * a total order is what stops `sort` from seeing an inconsistent comparator.
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
 * Both ends wrap. A null selection enters at the first row with Down and the
 * final row with Up, which also keeps this helper safe while results change.
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
