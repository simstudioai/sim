import { queryBrowserDatabase } from '@/main/browser-import/sqlite-source'
import { toNumber, toText } from '@/main/browser-import/types'

/**
 * Reads which sites a Chromium profile's owner actually uses, out of its
 * `History` database.
 *
 * This is the seed for the omnibox, and history is the only honest source for
 * it. The obvious alternative — the cookie jar — is not a list of sites anyone
 * visits: it is every origin that ever set state, which is dominated by ad
 * networks, analytics, and embedded widgets the user never navigated to. Rows
 * in `urls` are pages someone opened, so trackers are structurally absent.
 *
 * Cookies still get a say, as a filter: only hosts covered by a cookie the
 * import brought over come back, so what is remembered stays within the data
 * the user chose to bring. Sim's browser records no history of its own, and
 * none is reconstructed here — no visit times, no URLs beyond the host, no
 * sequence. What survives is a host, what its own titles call it, and how much
 * it is used relative to the others.
 */

/**
 * Rows scanned from one profile. Set well past the size of a real history —
 * Chrome expires visits at 90 days — so the cut is a guard against a pathological
 * file rather than something a normal profile meets.
 *
 * Ordering by `visit_count` before the cut matters: per-host counts are summed,
 * so truncating has to drop the rows that contribute least to any sum. A profile
 * large enough to hit this still ranks on its most-visited pages.
 */
const MAX_ROWS = 200_000
/** Longer than this is a page title, not what the site is called. */
const MAX_NAME_LENGTH = 40
/** Hosts one import may contribute, most-used first. Bounds the favicon lookup too. */
export const MAX_IMPORTED_SITES = 200

/**
 * `hidden` marks rows Chromium itself keeps out of autocomplete — redirect
 * hops and other URLs nobody chose to open. Excluding them is the same
 * predicate Chrome's own omnibox uses.
 */
const SITE_QUERY = `
  SELECT url, title, visit_count
  FROM urls
  WHERE hidden = 0
  ORDER BY visit_count DESC
  LIMIT ${MAX_ROWS}
`

/** Separators sites put between the page and their own name. */
const TITLE_SEPARATOR = /\s+[|·•‧–—]\s+|\s+-\s+|\s+:\s+/

/** A host the source browser's owner visited, and what it is called there. */
export interface ImportedSite {
  hostname: string
  name?: string
  /**
   * The source browser's own visit count. An aggregate popularity signal used
   * to order suggestions — never a timestamp, a URL, or a sequence of visits.
   */
  visits: number
}

function hostnameOf(url: string): string | null {
  try {
    const { hostname, protocol } = new URL(url)
    // Extension and file pages are not sites the omnibox can offer.
    if (protocol !== 'https:' && protocol !== 'http:') return null
    return hostname || null
  } catch {
    return null
  }
}

/**
 * `visit_count` for one row. Goes through {@link toNumber} because the shared
 * reader enables BigInt reads, so every SQLite integer arrives as `bigint` — a
 * bare `typeof value === 'number'` guard silently scores every site zero.
 */
function visitsOf(value: unknown): number {
  const count = toNumber(value)
  return count > 0 ? Math.floor(count) : 0
}

/**
 * Whether a cookie covers this host.
 *
 * Cookie hosts arrive with the domain-cookie dot already stripped, so
 * `.google.com` reaches here as `google.com` while the page the user opened is
 * `www.google.com` or `mail.google.com`. Matching on equality alone would miss
 * every site not served from its apex — which is most of them — so each of the
 * host's parent suffixes is tried. Walking labels keeps this O(labels) per row
 * rather than scanning the whole cookie set.
 */
export function isCoveredByDomain(hostname: string, domains: ReadonlySet<string>): boolean {
  if (domains.has(hostname)) return true
  let dot = hostname.indexOf('.')
  while (dot !== -1) {
    if (domains.has(hostname.slice(dot + 1))) return true
    dot = hostname.indexOf('.', dot + 1)
  }
  return false
}

/**
 * The parts of a page title that could be the site's name.
 *
 * A title is typically the page, then the site: "Inbox (12) - Gmail". Which
 * end holds the name is not consistent enough to pick by position — "GitHub -
 * Where software is built" puts it first — so every segment is a candidate and
 * frequency decides between them.
 */
function nameCandidates(title: string): string[] {
  return title
    .split(TITLE_SEPARATOR)
    .map((segment) => segment.trim())
    .filter((segment) => segment.length > 0 && segment.length <= MAX_NAME_LENGTH)
}

/**
 * The site's name is the part of its titles that does not change: every Gmail
 * page ends in "Gmail" while the rest of each title differs, so the segment
 * appearing across the most distinct pages of a host is its name. Ties go to
 * the shorter candidate, which prefers "GitHub" over a tagline, and then to
 * alphabetical order so the same profile always imports the same name.
 */
function bestName(candidates: Map<string, Set<string>>): string | undefined {
  let best: { name: string; pages: number } | null = null
  for (const [candidate, seenIn] of candidates) {
    const pages = seenIn.size
    if (
      !best ||
      pages > best.pages ||
      (pages === best.pages &&
        (candidate.length < best.name.length ||
          (candidate.length === best.name.length && candidate < best.name)))
    ) {
      best = { name: candidate, pages }
    }
  }
  return best?.name
}

/**
 * The most-used hosts in this profile's history that `domains` covers, keyed by
 * the host actually visited — the same string the omnibox and the favicon store
 * use, so lookups downstream cannot miss.
 *
 * Never throws. A profile with no readable history contributes no sites, and
 * the caller carries on with whatever the rest of the import found.
 */
export async function readBrowserSites(
  historyPath: string,
  domains: ReadonlySet<string>
): Promise<ImportedSite[]> {
  if (domains.size === 0) return []

  let rows: Record<string, unknown>[]
  try {
    rows = await queryBrowserDatabase(historyPath, 'History', SITE_QUERY)
  } catch {
    // History is a nicety layered on the cookies that were already imported.
    // Chrome holding a lock on it must not fail the import.
    return []
  }

  /** host -> candidate name -> the distinct page titles that produced it. */
  const tally = new Map<string, Map<string, Set<string>>>()
  const visits = new Map<string, number>()

  for (const row of rows) {
    const hostname = hostnameOf(toText(row.url))
    if (hostname === null || !isCoveredByDomain(hostname, domains)) continue

    // Summed across the host's pages, not maxed: how much a site is used is
    // every page opened there, so a site visited broadly must not lose to one
    // visited only through a single much-refreshed page.
    visits.set(hostname, (visits.get(hostname) ?? 0) + visitsOf(row.visit_count))

    const title = toText(row.title)
    if (title === '') continue
    const candidates = tally.get(hostname) ?? new Map<string, Set<string>>()
    for (const candidate of nameCandidates(title)) {
      const seenIn = candidates.get(candidate) ?? new Set<string>()
      seenIn.add(title)
      candidates.set(candidate, seenIn)
    }
    tally.set(hostname, candidates)
  }

  const sites: ImportedSite[] = []
  for (const [hostname, count] of visits) {
    const candidates = tally.get(hostname)
    sites.push({
      hostname,
      name: candidates ? bestName(candidates) : undefined,
      visits: count,
    })
  }

  // Most-used first, then alphabetical so the same profile always imports the
  // same list, and only as many as the directory is willing to carry.
  sites.sort((a, b) => b.visits - a.visits || a.hostname.localeCompare(b.hostname))
  return sites.slice(0, MAX_IMPORTED_SITES)
}
