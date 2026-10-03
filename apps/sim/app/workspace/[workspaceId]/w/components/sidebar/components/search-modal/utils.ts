import type { ComponentType } from 'react'
import { toSearchToken } from '@/lib/search/tokens'
import type { SearchBlockItem, SearchToolOperationItem } from '@/stores/modals/search/types'

/**
 * Every result group the palette can render. This is also the canonical order:
 * the zero-query browse list and the flat search tie-break both follow it,
 * with two page-aware insertions at the front — the page's action group, then
 * its own entity section hoisted above `actions`' platform group.
 */
export const SEARCH_SECTIONS = [
  'actions',
  'blocks',
  'triggers',
  'tools',
  'toolOperations',
  'pages',
  'workflows',
  'workspaces',
  'files',
  'tables',
  'knowledgeBases',
  'logs',
  'connectedAccounts',
  'chats',
  'integrations',
] as const

/** A single search-modal result group. */
export type SearchSection = (typeof SEARCH_SECTIONS)[number]

/**
 * Canvas building-block sections. They render between the page's action group
 * and the Sim group; off the canvas they carry no items and render nothing.
 */
export const CANVAS_SECTIONS = ['blocks', 'triggers', 'tools', 'toolOperations'] as const

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
  /** Formatted last-activity date shown as trailing metadata. Set for chats. */
  date?: string
}

/**
 * A {@link TaskItem} that lives in a folder tree, so the row can show which
 * folder it came from — a name is only unique within its folder.
 */
export interface FolderedItem extends TaskItem {
  /** Owning folder names, root first. */
  folderPath?: string[]
}

export interface WorkflowItem extends FolderedItem {
  isCurrent?: boolean
}

export interface WorkspaceItem {
  id: string
  name: string
  href: string
  isCurrent?: boolean
  logoUrl?: string | null
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

export type FileItem = FolderedItem

export interface LogItem {
  id: string
  /** Workflow (or job) name the execution belongs to. */
  name: string
  href: string
  /** Human-readable run date shown as trailing metadata. */
  date: string
}

/**
 * Pages that contribute their own palette actions while active. Each page
 * registers its handlers as global commands on mount; the palette invokes
 * them by id and only offers them while the matching route is mounted.
 */
export type PageActionContext =
  | 'workflow'
  | 'tables'
  | 'tableDetail'
  | 'files'
  | 'fileDetail'
  | 'knowledge'
  | 'knowledgeBase'
  | 'logs'
  | 'logsDashboard'

/** Where an {@link ActionItem} (a verb) is available. */
export type ActionContext = 'global' | PageActionContext

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
  /**
   * Lowercase queries that name this action outright — the module it heads
   * (`'workflows'` for Create workflow) or its bare verb (`'deploy'`,
   * `'copy'`). When the trimmed query IS one of these, the action ranks like
   * a page row ({@link PAGE_MATCH_TIER}), above section-lifted and
   * exact-name entity rows.
   */
  exactQueries?: readonly string[]
  icon: ComponentType<{ className?: string }>
  shortcut?: string
  context: ActionContext
  run: () => void
}

export type ActionGroupLabel = 'Sim' | 'Actions'

/**
 * The page's own entity section, hoisted directly under its action group in
 * both the browse list and the search tie-break.
 */
export const PAGE_CONTEXT_HOISTED_SECTION: Partial<Record<PageActionContext, SearchSection>> = {
  tables: 'tables',
  tableDetail: 'tables',
  files: 'files',
  fileDetail: 'files',
  knowledge: 'knowledgeBases',
  knowledgeBase: 'knowledgeBases',
  logs: 'logs',
  logsDashboard: 'logs',
}

/** Presentation group for an action without changing its stable result identity. */
export function getActionGroupLabel(action: ActionItem): ActionGroupLabel {
  return action.context === 'global' ? 'Sim' : 'Actions'
}

export interface SearchModalProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  workflows?: WorkflowItem[]
  workspaces?: WorkspaceItem[]
  chats?: TaskItem[]
  /**
   * Tables, files, and knowledge bases are NOT passed in: the content component reads them
   * itself, so those three workspace-wide lists are queried only while the palette is open.
   * The sidebar renders on every workspace route, so fetching them there registered the keys
   * in the cache on routes that never show them.
   */
  logs?: LogItem[]
  integrations?: IntegrationSearchItem[]
  connectedAccounts?: IntegrationSearchItem[]
  /** Page the palette was opened on, when that page contributes actions. */
  pageContext?: PageActionContext | null
  canEdit?: boolean
  canAdmin?: boolean
  onCreateWorkflow?: () => void
  onCreateFolder?: () => void
  onImportWorkflow?: () => void
}

export interface CommandItemProps {
  value: string
  onSelect: () => void
  icon: ComponentType<{ className?: string }>
  bgColor: string
  /**
   * Block the row names, when it names one. Decides whether the tile takes the
   * canvas role accent or the row's own `bgColor`. @see hasBlockAccent
   */
  blockType?: string
  /** Primary text of the row. */
  label: string
  /** De-emphasized lead-in before the label (e.g. a tool operation's service). */
  labelPrefix?: string
  /** Right-aligned trailing metadata. */
  meta?: string
}

export const SECTION_LABELS: Record<SearchSection, string> = {
  actions: 'Sim',
  blocks: 'Blocks',
  triggers: 'Triggers',
  tools: 'Tools',
  toolOperations: 'Tool operations',
  pages: 'Pages',
  workflows: 'Workflows',
  workspaces: 'Workspaces',
  files: 'Files',
  tables: 'Tables',
  knowledgeBases: 'Knowledge Bases',
  logs: 'Logs',
  connectedAccounts: 'Connected Integrations',
  integrations: 'Integrations',
  chats: 'Chats',
}

export type SearchEntry =
  | { section: 'actions'; score: number; item: ActionItem }
  | { section: 'blocks' | 'tools' | 'triggers'; score: number; item: SearchBlockItem }
  | { section: 'toolOperations'; score: number; item: SearchToolOperationItem }
  | { section: 'connectedAccounts' | 'integrations'; score: number; item: IntegrationSearchItem }
  | { section: 'chats'; score: number; item: TaskItem }
  | { section: 'workflows'; score: number; item: WorkflowItem }
  | { section: 'tables' | 'knowledgeBases'; score: number; item: FolderedItem }
  | { section: 'files'; score: number; item: FileItem }
  | { section: 'logs'; score: number; item: LogItem }
  | { section: 'workspaces'; score: number; item: WorkspaceItem }
  | { section: 'pages'; score: number; item: PageItem }

export interface SearchEntryHandlers {
  onSelectAction: (item: ActionItem) => void
  onSelectBlock: (item: SearchBlockItem) => void
  onSelectTool: (item: SearchBlockItem) => void
  onSelectTrigger: (item: SearchBlockItem) => void
  onSelectToolOperation: (item: SearchToolOperationItem) => void
  onSelectConnectedAccount: (item: IntegrationSearchItem) => void
  onSelectIntegration: (item: IntegrationSearchItem) => void
  onSelectChat: (item: TaskItem) => void
  onSelectWorkflow: (item: WorkflowItem) => void
  onSelectTable: (item: FolderedItem) => void
  onSelectFile: (item: FileItem) => void
  onSelectKnowledgeBase: (item: FolderedItem) => void
  onSelectLog: (item: LogItem) => void
  onSelectWorkspace: (item: WorkspaceItem) => void
  onSelectPage: (item: PageItem) => void
}

/** Merge-ranks every match from the visible sections into one flat result list. */
export function getGlobalSearchResults(
  entriesBySection: Partial<Record<SearchSection, readonly SearchEntry[]>>,
  sections: readonly SearchSection[]
): SearchEntry[] {
  /* Flattening in section order makes the spec-stable sort's tie-break the
     section order (then within-section order) with no explicit comparator. */
  return sections
    .flatMap((section) => entriesBySection[section] ?? [])
    .sort((a, b) => b.score - a.score)
}

/**
 * `scroll-mt-12` mirrors the list's `pt-12`: the search input floats over the
 * top 48px of the scrollport, and cmdk keeps the selection visible with
 * `scrollIntoView({ block: 'nearest' })` — without the scroll margin, arrowing
 * upward (or loop-wrapping to the first row) parks the row under the input.
 * Group headings need the same margin because cmdk scrolls the heading into
 * view when the selection is its group's first row.
 */
export const GROUP_HEADING_CLASSNAME =
  '[&_[cmdk-group-heading]]:flex [&_[cmdk-group-heading]]:h-[18px] [&_[cmdk-group-heading]]:items-center [&_[cmdk-group-heading]]:px-2 [&_[cmdk-group-heading]]:mb-2 [&_[cmdk-group-heading]]:scroll-mt-12 [&_[cmdk-group-heading]]:text-small [&_[cmdk-group-heading]]:text-[var(--text-muted)]'

export const COMMAND_ITEM_CLASSNAME =
  'group mx-0.5 flex h-[30px] w-full cursor-pointer items-center gap-2 rounded-lg border border-transparent px-2 text-left text-sm scroll-mt-12 scroll-mb-1.5 aria-selected:border-[var(--border-1)] aria-selected:bg-[var(--surface-active)] data-[disabled=true]:pointer-events-none data-[disabled=true]:opacity-50'

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
 * Rank offset that lifts an entire section above every name match when the
 * query IS that section's name — typing "triggers" asks for the Triggers
 * section itself, not rows from other sections that happen to contain the word.
 */
const SECTION_MATCH_TIER = 2_000_000

/**
 * Rank offset for a page row whose name IS the query. Typing "logs" means the
 * Logs page itself first, then its contents (the section lifted into
 * {@link SECTION_MATCH_TIER}) beneath it.
 */
export const PAGE_MATCH_TIER = 3_000_000

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

/** Scores and sorts matches while retaining scores for cross-section ranking. */
export function scoreAndSort<T>(
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
 * Scores normal item matches first, then fills a matched section with its
 * remaining rows in natural order. A query that exactly names the section
 * lifts every returned row into {@link SECTION_MATCH_TIER}, keeping this
 * internal order but beating name matches from other sections.
 */
function scoreItemsForSection<T>(
  sectionLabel: string,
  items: T[],
  toValue: (item: T) => string,
  search: string,
  toExtra?: (item: T) => string | undefined,
  maxResults = Number.POSITIVE_INFINITY
): Array<{ item: T; score: number }> {
  const rankedItems = scoreAndSort(items, toValue, search, toExtra)
  const query = search.trim()
  const sectionMatch = fuzzyMatch(sectionLabel, query)
  const isExactLabelMatch =
    sectionMatch.matched && query.toLowerCase() === sectionLabel.toLowerCase()

  let results: Array<{ item: T; score: number }>
  if (!sectionMatch.matched || rankedItems.length >= maxResults) {
    results = rankedItems.slice(0, maxResults)
  } else {
    const matchedItems = new Set(rankedItems.map(({ item }) => item))
    const lowestItemScore = rankedItems.at(-1)?.score
    const fallbackScore =
      lowestItemScore === undefined
        ? sectionMatch.score
        : Math.min(sectionMatch.score, lowestItemScore - 1)

    results = [...rankedItems]
    for (const item of items) {
      if (!matchedItems.has(item)) results.push({ item, score: fallbackScore })
      if (results.length >= maxResults) break
    }
  }

  if (isExactLabelMatch) {
    return results.map(({ item }, index) => ({ item, score: SECTION_MATCH_TIER - index }))
  }
  return results
}

/**
 * Sections whose label never participates in matching. Tool operations are a
 * 1000+ registry-ordered list, so label-driven behavior ("tool operations"
 * lifting the section, or a partial hit like "tool" filling it) would surface
 * arbitrary rows; individual operations stay searchable by name and alias.
 */
const LABEL_MATCH_EXEMPT_SECTIONS = new Set<SearchSection>(['toolOperations'])

export function scoreSectionItems<T>(
  section: SearchSection,
  items: T[],
  toValue: (item: T) => string,
  search: string,
  toExtra?: (item: T) => string | undefined,
  maxResults = Number.POSITIVE_INFINITY
): Array<{ item: T; score: number }> {
  if (LABEL_MATCH_EXEMPT_SECTIONS.has(section)) {
    return scoreAndSort(items, toValue, search, toExtra).slice(0, maxResults)
  }
  return scoreItemsForSection(SECTION_LABELS[section], items, toValue, search, toExtra, maxResults)
}

/**
 * Rank offset added to a matched action. Actions are the palette's few
 * runnable verbs, so a matched action outranks entity rows of the same match
 * quality — a name-matched action beats name-matched entities, a
 * keyword-matched action beats other secondary-text matches — while the
 * half-tier offset deliberately cannot bridge into the next tier up
 * ({@link SECTION_MATCH_TIER}, {@link PAGE_MATCH_TIER}). A name hit that
 * starts mid-word ("h" in "New chat") is NOT the same quality as the
 * word-start matches the offset would leapfrog, so it forgoes the bias.
 */
export const ACTION_MATCH_BIAS = 500_000

/**
 * Whether a match begins where a word begins — the string start, right after a
 * separator, or at a camelCase hump. The empty query (no positions) counts as
 * a word start.
 */
function isWordStartMatch(text: string, positions: readonly number[]): boolean {
  if (positions.length === 0) return true
  return isHardBoundary(text.toLowerCase(), positions[0]) || isCamelBoundary(text, positions[0])
}

/**
 * Scores actions by visible name before falling back to their keywords.
 * Word-start matches are lifted by {@link ACTION_MATCH_BIAS}; a mid-word name
 * hit keeps its honest score so word-start entity matches outrank it; a query
 * listed in the action's `exactQueries` ranks it like a page row instead.
 */
export function scoreActions(
  actions: ActionItem[],
  search: string,
  maxResults = Number.POSITIVE_INFINITY,
  groupLabel: ActionGroupLabel = 'Sim'
): Array<{ item: ActionItem; score: number }> {
  const query = search.trim().toLowerCase()
  return scoreItemsForSection(
    groupLabel,
    actions,
    (action) => action.name,
    search,
    (action) => `${toSearchToken(action.name)} ${action.keywords ?? ''}`,
    maxResults
  ).map(({ item, score }) => {
    if (item.exactQueries?.includes(query)) return { item, score: PAGE_MATCH_TIER }
    /* Section-lifted rows (the query IS the group label) keep the bias
       wholesale — only plain name-tier scores are quality-checked. */
    const byName = fuzzyMatch(item.name, query)
    const midWordNameMatch =
      score < SECTION_MATCH_TIER && byName.matched && !isWordStartMatch(item.name, byName.positions)
    return { item, score: midWordNameMatch ? score : score + ACTION_MATCH_BIAS }
  })
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
export const MAX_RESULTS_PER_GROUP = 50

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
