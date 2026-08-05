import type { ComponentType } from 'react'
import type {
  SearchBlockItem,
  SearchDocItem,
  SearchSection,
  SearchToolOperationItem,
} from '@/stores/modals/search/types'

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

/**
 * A {@link TaskItem} that lives in a folder tree, so the row can show which
 * folder it came from — a name is only unique within its folder.
 */
export interface FolderedItem extends TaskItem {
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
  color?: string
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

export type ActionGroupLabel = 'Platform' | 'Workflow'

/** Presentation group for an action without changing its stable result identity. */
export function getActionGroupLabel(action: ActionItem): ActionGroupLabel {
  return action.context === 'workflow' ? 'Workflow' : 'Platform'
}

export interface SearchModalProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  workflows?: WorkflowItem[]
  workspaces?: WorkspaceItem[]
  chats?: TaskItem[]
  tables?: FolderedItem[]
  files?: FileItem[]
  knowledgeBases?: FolderedItem[]
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
  onSelect: () => void
  icon: ComponentType<{ className?: string }>
  bgColor: string
  showColoredIcon?: boolean
  /**
   * Core workflow block type. Renders as the shared accent chip only when the
   * type has a mapped accent; unmapped types — every integration block — fall
   * back to their catalog `bgColor` tile.
   */
  workflowType?: string
  /** Primary text of the row. */
  label: string
  /** Right-aligned source section shown in aggregate result groups. */
  meta?: string
}

export const SECTION_LABELS: Record<SearchSection, string> = {
  actions: 'Platform',
  connectedAccounts: 'Connected',
  integrations: 'Integrations',
  blocks: 'Blocks',
  tools: 'Tools',
  triggers: 'Triggers',
  chats: 'Chats',
  workflows: 'Workflows',
  tables: 'Tables',
  files: 'Files',
  knowledgeBases: 'Knowledge bases',
  toolOperations: 'Tool operations',
  workspaces: 'Workspaces',
  docs: 'Docs',
  pages: 'Pages',
}

export type SearchEntry =
  | { section: 'actions'; score: number; item: ActionItem }
  | { section: 'connectedAccounts' | 'integrations'; score: number; item: IntegrationSearchItem }
  | { section: 'blocks' | 'tools' | 'triggers'; score: number; item: SearchBlockItem }
  | { section: 'chats'; score: number; item: TaskItem }
  | { section: 'workflows'; score: number; item: WorkflowItem }
  | { section: 'tables' | 'knowledgeBases'; score: number; item: TaskItem }
  | { section: 'files'; score: number; item: FileItem }
  | { section: 'toolOperations'; score: number; item: SearchToolOperationItem }
  | { section: 'workspaces'; score: number; item: WorkspaceItem }
  | { section: 'docs'; score: number; item: SearchDocItem }
  | { section: 'pages'; score: number; item: PageItem }

export interface SearchEntryHandlers {
  onSelectAction: (item: ActionItem) => void
  onSelectConnectedAccount: (item: IntegrationSearchItem) => void
  onSelectIntegration: (item: IntegrationSearchItem) => void
  onSelectBlock: (item: SearchBlockItem) => void
  onSelectTool: (item: SearchBlockItem) => void
  onSelectTrigger: (item: SearchBlockItem) => void
  onSelectChat: (item: TaskItem) => void
  onSelectWorkflow: (item: WorkflowItem) => void
  onSelectTable: (item: TaskItem) => void
  onSelectFile: (item: FileItem) => void
  onSelectKnowledgeBase: (item: TaskItem) => void
  onSelectToolOperation: (item: SearchToolOperationItem) => void
  onSelectWorkspace: (item: WorkspaceItem) => void
  onSelectDoc: (item: SearchDocItem) => void
  onSelectPage: (item: PageItem) => void
}

/** Merge-ranks every match from the visible sections into one flat result list. */
export function getGlobalSearchResults(
  entriesBySection: Partial<Record<SearchSection, readonly SearchEntry[]>>,
  sections: readonly SearchSection[]
): SearchEntry[] {
  const sectionOrder = new Map(sections.map((section, index) => [section, index]))
  const rankedMatches: Array<{ entry: SearchEntry; originalIndex: number }> = []
  let originalIndex = 0

  const compare = (
    a: { entry: SearchEntry; originalIndex: number },
    b: { entry: SearchEntry; originalIndex: number }
  ) =>
    b.entry.score - a.entry.score ||
    (sectionOrder.get(a.entry.section) ?? sections.length) -
      (sectionOrder.get(b.entry.section) ?? sections.length) ||
    a.originalIndex - b.originalIndex

  for (const section of sections) {
    for (const entry of entriesBySection[section] ?? []) {
      rankedMatches.push({ entry, originalIndex })
      originalIndex += 1
    }
  }

  rankedMatches.sort(compare)
  const matches = rankedMatches.map(({ entry }) => entry)
  const integrationDetails = [
    ...matches.filter((entry) => entry.section === 'toolOperations'),
    ...matches.filter((entry) => entry.section === 'docs'),
  ]
  let integrationDetailIndex = 0

  return matches.map((entry) => {
    if (entry.section !== 'toolOperations' && entry.section !== 'docs') return entry
    const orderedEntry = integrationDetails[integrationDetailIndex]
    integrationDetailIndex += 1
    return orderedEntry
  })
}

export const GROUP_HEADING_CLASSNAME =
  '[&_[cmdk-group-heading]]:flex [&_[cmdk-group-heading]]:h-[18px] [&_[cmdk-group-heading]]:items-center [&_[cmdk-group-heading]]:px-2 [&_[cmdk-group-heading]]:mb-2 [&_[cmdk-group-heading]]:text-small [&_[cmdk-group-heading]]:text-[var(--text-muted)]'

export const COMMAND_ITEM_CLASSNAME =
  'group mx-0.5 flex h-[30px] w-full cursor-pointer items-center gap-2 rounded-lg border border-transparent px-2 text-left text-sm aria-selected:border-[var(--border-1)] aria-selected:bg-[var(--surface-active)] data-[disabled=true]:pointer-events-none data-[disabled=true]:opacity-50'

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

/** Rank offset that lifts every name match above any secondary-text match. */
const NAME_MATCH_TIER = 1_000_000

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
  const byExtra = fuzzyMatch(extra, search)
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

function matchesIntegrationQuery(integrationName: string, search: string): boolean {
  const query = search.trim()
  if (!query) return false

  return query.split(/\s+/).some((term) => fuzzyMatch(integrationName, term).matched)
}

/** Adds integration context only when it, rather than the operation name, matched the query. */
export function getToolOperationLabel(operation: SearchToolOperationItem, search: string): string {
  const query = search.trim()
  if (!query || fuzzyMatch(operation.name, query).matched) return operation.name

  return matchesIntegrationQuery(operation.serviceName, query)
    ? `${operation.serviceName} · ${operation.name}`
    : operation.name
}

/**
 * Scores normal item matches first, then fills a matched section with its
 * remaining rows in natural order.
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
  const sectionMatch = fuzzyMatch(sectionLabel, search.trim())
  if (!sectionMatch.matched || rankedItems.length >= maxResults) {
    return rankedItems.slice(0, maxResults)
  }

  const matchedItems = new Set(rankedItems.map(({ item }) => item))
  const lowestItemScore = rankedItems.at(-1)?.score
  const fallbackScore =
    lowestItemScore === undefined
      ? sectionMatch.score
      : Math.min(sectionMatch.score, lowestItemScore - 1)

  const results = [...rankedItems]
  for (const item of items) {
    if (!matchedItems.has(item)) results.push({ item, score: fallbackScore })
    if (results.length >= maxResults) break
  }
  return results
}

export function scoreSectionItems<T>(
  section: SearchSection,
  items: T[],
  toValue: (item: T) => string,
  search: string,
  toExtra?: (item: T) => string | undefined,
  maxResults = Number.POSITIVE_INFINITY
): Array<{ item: T; score: number }> {
  return scoreItemsForSection(SECTION_LABELS[section], items, toValue, search, toExtra, maxResults)
}

/** Scores actions by visible name before falling back to their keywords. */
export function scoreActions(
  actions: ActionItem[],
  search: string,
  maxResults = Number.POSITIVE_INFINITY,
  groupLabel: ActionGroupLabel = 'Platform'
): Array<{ item: ActionItem; score: number }> {
  return scoreItemsForSection(
    groupLabel,
    actions,
    (action) => action.name,
    search,
    (action) => `${action.name} ${action.keywords ?? ''}`,
    maxResults
  )
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
