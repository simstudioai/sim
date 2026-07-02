import type { ComponentType } from 'react'

export interface IntegrationSearchItem {
  id: string
  name: string
  href: string
  icon: ComponentType<{ className?: string }>
  bgColor: string
}

export interface TaskItem {
  id: string
  name: string
  href: string
}

export interface WorkflowItem {
  id: string
  name: string
  href: string
  folderPath?: string[]
  isCurrent?: boolean
}

export interface WorkspaceItem {
  id: string
  name: string
  href: string
  isCurrent?: boolean
}

export interface PageItem {
  id: string
  name: string
  icon: ComponentType<{ className?: string }>
  href?: string
  onClick?: () => void
  shortcut?: string
  hidden?: boolean
}

export interface FileItem {
  id: string
  name: string
  href: string
  folderPath?: string[]
}

/** Where an {@link ActionItem} (a verb) is available. */
export type ActionContext = 'global' | 'workflow' | 'integrations'

/**
 * An action is a verb the palette can run directly (create, import, toggle),
 * as opposed to an entity the user navigates to. Actions render at the top of
 * the result list so the most common "do something" intents are one keystroke
 * away.
 */
export interface ActionItem {
  id: string
  name: string
  /** Extra terms folded into the search value (e.g. "new add"). */
  keywords?: string
  icon: ComponentType<{ className?: string }>
  shortcut?: string
  context: ActionContext
  run: () => void
}

export interface SearchModalProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  workflows?: WorkflowItem[]
  workspaces?: WorkspaceItem[]
  chats?: TaskItem[]
  tables?: TaskItem[]
  files?: FileItem[]
  knowledgeBases?: TaskItem[]
  integrations?: IntegrationSearchItem[]
  connectedAccounts?: IntegrationSearchItem[]
  isOnWorkflowPage?: boolean
  isOnIntegrationsPage?: boolean
  canEdit?: boolean
  onCreateWorkflow?: () => void
  onCreateFolder?: () => void
  onImportWorkflow?: () => void
}

export interface CommandItemProps {
  value: string
  /** Receives the row's cmdk `value` — dispatch through a group-level lookup, never a per-row closure. */
  onSelect: (value: string) => void
  icon: ComponentType<{ className?: string }>
  bgColor: string
  showColoredIcon?: boolean
  /** Primary text. Matched characters are highlighted against {@link query}. */
  label: string
  /** Active search query, used to bold matched characters. */
  query?: string
}

export const GROUP_HEADING_CLASSNAME =
  '[&_[cmdk-group-heading]]:flex [&_[cmdk-group-heading]]:h-[18px] [&_[cmdk-group-heading]]:items-center [&_[cmdk-group-heading]]:px-2 [&_[cmdk-group-heading]]:mb-2 [&_[cmdk-group-heading]]:text-small [&_[cmdk-group-heading]]:text-[var(--text-muted)]'

/**
 * Defers layout/paint for off-screen rows without full virtualization — rows
 * stay real DOM nodes, so cmdk's keyboard nav and `scrollIntoView` need no
 * changes. `30px` is the placeholder size before a row's first real paint,
 * matching its fixed height.
 */
export const COMMAND_ITEM_CLASSNAME =
  'group mx-0.5 flex h-[30px] w-full cursor-pointer items-center gap-2 rounded-lg border border-transparent px-2 text-left text-sm aria-selected:border-[var(--border-1)] aria-selected:bg-[var(--surface-active)] data-[disabled=true]:pointer-events-none data-[disabled=true]:opacity-50 [content-visibility:auto] [contain-intrinsic-size:auto_30px]'

/** Neutral brand-tile color for rows with no per-item brand color (docs) or an unresolved integration (credentials). */
export const FALLBACK_BG_COLOR = '#6B7280'

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
 * Contiguous substring matches report the indices of the substring itself, so
 * highlighting always bolds the run the user actually matched rather than an
 * earlier scattered occurrence of the same characters.
 */
export function fuzzyMatch(text: string, query: string): FuzzyResult {
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

/** An item paired with its fuzzy-match score, for ranking across groups. */
export interface ScoredMatch<T> {
  item: T
  score: number
}

/**
 * Fuzzy-matches and score-sorts items descending. When the search is empty,
 * every item is returned unscored (score 0) in its original order — a stable
 * sort by score then leaves order untouched, so this doubles as the no-search
 * fast path for callers that also want a score.
 */
export function filterAndScore<T>(
  items: T[],
  toValue: (item: T) => string,
  search: string
): ScoredMatch<T>[] {
  if (!search) return items.map((item) => ({ item, score: 0 }))
  const scored: ScoredMatch<T>[] = []
  for (const item of items) {
    const { matched, score } = fuzzyMatch(toValue(item), search)
    if (matched) scored.push({ item, score })
  }
  scored.sort((a, b) => b.score - a.score)
  return scored
}

/**
 * Filters items whose value fuzzy-matches the search, ordered by descending
 * score. Returns the input untouched when the search is empty.
 */
export function filterAndSort<T>(items: T[], toValue: (item: T) => string, search: string): T[] {
  if (!search) return items
  return filterAndScore(items, toValue, search).map((entry) => entry.item)
}
