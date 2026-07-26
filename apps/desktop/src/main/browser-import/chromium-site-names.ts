import { queryBrowserDatabase } from '@/main/browser-import/sqlite-source'
import { toText } from '@/main/browser-import/types'

/**
 * Reads what each site calls itself out of a Chromium profile's `History`
 * database.
 *
 * Sim's browser keeps no history of its own, so it has no way to learn that
 * `mail.google.com` is called Gmail. The browser being imported from does
 * know, because it has the titles of pages the user actually opened, and that
 * is a per-user fact rather than a list of well-known sites hardcoded here.
 *
 * Only the hosts already being imported are read, and only their names come
 * back. A visit log is neither returned nor stored: this reduces a browsing
 * history to one string per site the user is bringing over anyway.
 */

const MAX_ROWS = 50_000
/** Longer than this is a page title, not what the site is called. */
const MAX_NAME_LENGTH = 40

const TITLE_QUERY = `
  SELECT url, title
  FROM urls
  WHERE title IS NOT NULL AND title != ''
  ORDER BY visit_count DESC
  LIMIT ${MAX_ROWS}
`

/** Separators sites put between the page and their own name. */
const TITLE_SEPARATOR = /\s+[|·•‧–—]\s+|\s+-\s+|\s+:\s+/

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
 * The name of each host in `hostnames`, drawn from that host's page titles.
 *
 * The site's name is the part of its titles that does not change: every Gmail
 * page ends in "Gmail" while the rest of each title differs, so the segment
 * appearing across the most distinct pages of a host is its name. Ties go to
 * the shorter candidate, which prefers "GitHub" over a tagline, and then to
 * alphabetical order so the same profile always imports the same name.
 *
 * Never throws. A profile with no readable history simply contributes no
 * names, and the caller falls back to showing the hostname.
 */
export async function readBrowserSiteNames(
  historyPath: string,
  hostnames: ReadonlySet<string>
): Promise<Map<string, string>> {
  if (hostnames.size === 0) return new Map()

  let rows: Record<string, unknown>[]
  try {
    rows = await queryBrowserDatabase(historyPath, 'History', TITLE_QUERY)
  } catch {
    // A name is a nicety. Failing to read one must not fail the import.
    return new Map()
  }

  /** host -> candidate -> the distinct page titles that produced it. */
  const tally = new Map<string, Map<string, Set<string>>>()
  for (const row of rows) {
    const hostname = hostnameOf(toText(row.url))
    if (hostname === null || !hostnames.has(hostname)) continue

    const title = toText(row.title)
    const candidates = tally.get(hostname) ?? new Map<string, Set<string>>()
    for (const candidate of nameCandidates(title)) {
      const seenIn = candidates.get(candidate) ?? new Set<string>()
      seenIn.add(title)
      candidates.set(candidate, seenIn)
    }
    tally.set(hostname, candidates)
  }

  const names = new Map<string, string>()
  for (const [hostname, candidates] of tally) {
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
    if (best) names.set(hostname, best.name)
  }

  return names
}
