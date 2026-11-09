/** Characters that begin a new word — a match here scores higher. */
const SEPARATORS = new Set([' ', '-', '_', '/', '.', ':', '(', ')'])

/** Result of matching a query against a single candidate string. */
export interface FuzzyResult {
  /** Whether every query character was found, in order. */
  matched: boolean
  /** Relative ranking score; higher sorts first. Only meaningful when matched. */
  score: number
  /** Indices into the candidate string that matched, ascending. Read-only. */
  positions: readonly number[]
}

/**
 * Shared singleton for the no-match case. The frozen empty array makes the
 * read-only contract explicit and guarantees the shared instance can never be
 * mutated by a caller.
 */
const NO_MATCH: FuzzyResult = { matched: false, score: 0, positions: Object.freeze([]) }

function isCamelBoundary(text: string, index: number): boolean {
  if (index === 0) return false
  const prev = text[index - 1]
  const curr = text[index]
  return prev === prev.toLowerCase() && curr !== curr.toLowerCase() && curr === curr.toUpperCase()
}

/**
 * A "hard" boundary: the start of the string or immediately after a separator.
 * Used to anchor scattered matches. Deliberately excludes camelCase so a fuzzy
 * match cannot *start* in the middle of a word (e.g. the `S` in "PageSpeed"),
 * which would let short queries scatter-match unrelated items. Interior
 * camelCase still earns a scoring bonus — it just cannot anchor a match.
 */
function isHardBoundary(lowerText: string, index: number): boolean {
  return index === 0 || SEPARATORS.has(lowerText[index - 1])
}

/**
 * Order-independent fallback: a multi-word query matches when every token
 * appears somewhere in the text. Preserves the original matcher's multi-word
 * behavior (`message slack` → "Slack Send Message"). Single-word queries that
 * reach here did not match as exact/prefix/contains and are rejected, so this
 * never broadens single-token matching beyond the original behavior.
 */
function tokenFallback(lowerText: string, lowerQuery: string): FuzzyResult {
  const tokens = lowerQuery.split(/\s+/).filter(Boolean)
  if (tokens.length <= 1 || !tokens.every((token) => lowerText.includes(token))) return NO_MATCH

  const tokenPositions = new Set<number>()
  for (const token of tokens) {
    const start = lowerText.indexOf(token)
    for (let k = 0; k < token.length; k++) tokenPositions.add(start + k)
  }
  return {
    matched: true,
    score: 10 - lowerText.length * 0.1,
    positions: Array.from(tokenPositions).sort((a, b) => a - b),
  }
}

/**
 * Subsequence fuzzy match with positional scoring. Rewards matches at word
 * boundaries (`slk` → **S**lack), consecutive runs, and prefix/exact hits,
 * while still matching scattered characters so typos and partial recall work.
 *
 * Exact, prefix, contains, and multi-word token matches all reproduce the
 * original substring matcher's behavior, making this a strict superset: any
 * result the old matcher returned, this one returns too. The only additions are
 * scattered subsequences, and those are accepted only when the match STARTS at a
 * hard word boundary — so initialisms match (`slk` → **S**la**c**k) but loose
 * noise does not (`slack` will not scatter-match "Page**S**peed", and `se` will
 * not match every item containing s…e).
 *
 * Falls back to order-independent token matching for multi-word queries
 * (`message slack` matches "Slack Send Message") which a strict left-to-right
 * subsequence would miss.
 *
 * Contiguous substring matches report the indices of the substring itself
 * rather than an earlier scattered occurrence of the same characters.
 *
 * Pass `scatter: false` to skip the scattered-subsequence mode. Over long
 * multi-word text (alias lists, option labels) a scattered query matches
 * almost anything — "whatsapp" finds `w…h…a…t…s…a…p…p` across unrelated alias
 * words — so secondary-text matching keeps only the exact/prefix/substring
 * and multi-word token modes.
 */
export function fuzzyMatch(
  text: string,
  query: string,
  options?: { scatter?: boolean }
): FuzzyResult {
  if (!query) return { matched: true, score: 1, positions: [] }
  if (!text) return NO_MATCH

  const lowerText = text.toLowerCase()
  const lowerQuery = query.toLowerCase()

  const substringIndex = lowerText.indexOf(lowerQuery)
  if (substringIndex !== -1) {
    const length = lowerQuery.length
    const positions = Array.from({ length }, (_, k) => substringIndex + k)

    let score = 1
    if (substringIndex === 0) score += 10
    else if (SEPARATORS.has(lowerText[substringIndex - 1])) score += 8
    else if (isCamelBoundary(text, substringIndex)) score += 6
    score += (length - 1) * 6

    if (lowerText === lowerQuery) score += 120
    else if (substringIndex === 0) score += 50
    else score += 25

    score -= substringIndex * 0.5
    score -= (length - 1) * 0.15
    score -= lowerText.length * 0.1
    return { matched: true, score, positions }
  }

  if (options?.scatter === false) return tokenFallback(lowerText, lowerQuery)

  const positions: number[] = []
  let queryIndex = 0
  let score = 0
  let prevMatch = -2

  for (let i = 0; i < lowerText.length && queryIndex < lowerQuery.length; i++) {
    if (lowerText[i] !== lowerQuery[queryIndex]) continue

    let charScore = 1
    if (i === 0) charScore += 10
    else if (SEPARATORS.has(lowerText[i - 1])) charScore += 8
    else if (isCamelBoundary(text, i)) charScore += 6
    if (prevMatch === i - 1) charScore += 5

    score += charScore
    positions.push(i)
    prevMatch = i
    queryIndex++
  }

  if (queryIndex === lowerQuery.length && isHardBoundary(lowerText, positions[0])) {
    score -= positions[0] * 0.5
    score -= (positions[positions.length - 1] - positions[0]) * 0.15
    score -= lowerText.length * 0.1
    return { matched: true, score, positions }
  }

  return tokenFallback(lowerText, lowerQuery)
}

/** Rank offset that lifts every name match above any secondary-text match. */
const NAME_MATCH_TIER = 1_000_000

/**
 * Matches a query against secondary search text: a space-separated list of
 * entries where multi-word phrases are kebab-cased into single tokens (see
 * `toSearchToken`). Whole-string matching keeps the exact/prefix/substring and
 * multi-word token modes; scattered matching runs against each entry
 * individually, so a query can scatter within one entry ("sndmsg" →
 * "send-message") but never assemble itself across unrelated entries
 * ("whatsapp" must not match "wealthbox-write-contact match snap up").
 */
/**
 * Secondary-text strings are stable catalog data (block/tool/operation search
 * values), so their word splits are cached — the palette re-matches every
 * miss on every keystroke, and re-splitting dominated that loop.
 */
const secondaryTextWords = new Map<string, string[]>()

function matchSecondaryText(extra: string, query: string): FuzzyResult {
  const whole = fuzzyMatch(extra, query, { scatter: false })
  let best = whole.matched ? whole : NO_MATCH
  let words = secondaryTextWords.get(extra)
  if (!words) {
    words = extra.split(/\s+/)
    secondaryTextWords.set(extra, words)
  }
  for (const word of words) {
    const byWord = fuzzyMatch(word, query)
    if (byWord.matched && (!best.matched || byWord.score > best.score)) best = byWord
  }
  return best
}

/**
 * Ranks an item by its name first, falling back to secondary text (ids, aliases,
 * option labels) only when the name doesn't match — a name match always wins, so
 * an exact name hit isn't diluted by a long secondary string ("Agent" beats
 * "Pi Coding Agent" for the query "agent").
 */
function scoreItem(name: string, search: string, getExtra?: () => string | undefined): FuzzyResult {
  const byName = fuzzyMatch(name, search)
  if (byName.matched) {
    return { matched: true, score: byName.score + NAME_MATCH_TIER, positions: byName.positions }
  }
  const extra = getExtra?.()
  if (!extra) return NO_MATCH
  const byExtra = matchSecondaryText(extra, search)
  return byExtra.matched ? byExtra : NO_MATCH
}

/** Scores and sorts matches, highest first. */
function scoreAndSort<T>(
  items: T[],
  toValue: (item: T) => string,
  search: string,
  toExtra?: (item: T) => string | undefined
): Array<{ item: T; score: number }> {
  const query = search.trim()
  const scored: Array<{ item: T; score: number }> = []
  for (const item of items) {
    const { matched, score } = scoreItem(
      toValue(item),
      query,
      toExtra ? () => toExtra(item) : undefined
    )
    if (matched) scored.push({ item, score })
  }
  scored.sort((a, b) => b.score - a.score)
  return scored
}

/**
 * Filters and ranks items by fuzzy match, highest score first; returns the input
 * unchanged when the search is empty or whitespace-only. Pass `toExtra` to rank
 * the name first and fall back to secondary text.
 */
export function filterAndSort<T>(
  items: T[],
  toValue: (item: T) => string,
  search: string,
  toExtra?: (item: T) => string | undefined
): T[] {
  if (!search.trim()) return items
  return scoreAndSort(items, toValue, search, toExtra).map((entry) => entry.item)
}

/**
 * Max rows rendered per group while searching. Re-rendering an unbounded,
 * reshuffling match set every keystroke is what stalls typing; results are
 * score-sorted, so the cap only drops the low-relevance tail.
 */
const MAX_RESULTS_PER_GROUP = 50

/**
 * {@link filterAndSort} bounded to {@link MAX_RESULTS_PER_GROUP} while searching,
 * so the per-keystroke render can't block typing. The empty browse state is
 * returned in full.
 */
export function filterAndCap<T>(
  items: T[],
  toValue: (item: T) => string,
  search: string,
  toExtra?: (item: T) => string | undefined
): T[] {
  const results = filterAndSort(items, toValue, search, toExtra)
  return search.trim() ? results.slice(0, MAX_RESULTS_PER_GROUP) : results
}
