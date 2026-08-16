import { createLogger } from '@sim/logger'
import { getErrorMessage } from '@sim/utils/errors'
import { sleep } from '@sim/utils/helpers'
import { backoffWithJitter } from '@sim/utils/retry'
import { fetchWithRetry, VALIDATE_RETRY_OPTIONS } from '@/lib/knowledge/documents/utils'
import { mondayConnectorMeta } from '@/connectors/monday/meta'
import type { ConnectorConfig, ExternalDocument, ExternalDocumentList } from '@/connectors/types'
import { parseMultiValue, parseTagDate } from '@/connectors/utils'
import { MONDAY_API_URL, mondayHeaders } from '@/tools/monday/utils'

const logger = createLogger('MondayConnector')

/** Max items requested per `items_page` / `next_items_page` call (monday.com max is 500). */
const ITEMS_PAGE_SIZE = 100

/** Boards requested per `boards` listing page (monday.com's default is 25, max 500). */
const BOARDS_PAGE_SIZE = 100

/**
 * Bound on the offset-paginated `boards` drain. `boards` exposes no cursor and no
 * total count, so an unbounded loop is only terminated by the API returning a
 * short page — this caps the walk at 5,000 boards instead of spinning forever.
 */
const MAX_BOARD_PAGES = 50

/** Max updates fetched per item for content extraction (monday.com's max is 100). */
const UPDATES_LIMIT = 50

interface MondayColumnValue {
  id: string
  text: string | null
  /**
   * Present only on the column types that dropped `text`. Selected via inline
   * fragments in {@link ITEM_FIELDS}.
   */
  display_value?: string | null
  column: { id: string; title: string } | null
}

interface MondayUpdate {
  id: string
  text_body: string | null
  created_at: string | null
  creator: { name: string | null } | null
}

interface MondayItem {
  id: string
  name: string | null
  state: string | null
  created_at: string | null
  updated_at: string | null
  url: string | null
  board: { id: string; name: string | null } | null
  group: { id: string; title: string | null } | null
  creator: { name: string | null } | null
  column_values: MondayColumnValue[]
  updates: MondayUpdate[]
}

interface MondayItemsPage {
  cursor: string | null
  items: MondayItem[]
}

interface MondayBoard {
  id: string
  name: string | null
  items_page: MondayItemsPage | null
}

/**
 * Pagination state encoded into `nextCursor`. Tracks which board in the
 * configured/accessible list is being read (`boardIndex`) and the opaque
 * `items_page` cursor within that board (`itemsCursor`).
 */
interface CursorState {
  boardIndex: number
  itemsCursor?: string
}

function encodeCursor(state: CursorState): string {
  return Buffer.from(JSON.stringify(state), 'utf8').toString('base64url')
}

function decodeCursor(cursor?: string): CursorState {
  if (!cursor) return { boardIndex: 0 }
  try {
    const json = Buffer.from(cursor, 'base64url').toString('utf8')
    const parsed = JSON.parse(json) as Partial<CursorState>
    return {
      boardIndex: Number(parsed.boardIndex) || 0,
      itemsCursor: typeof parsed.itemsCursor === 'string' ? parsed.itemsCursor : undefined,
    }
  } catch {
    return { boardIndex: 0 }
  }
}

interface MondayGraphQLError {
  message?: string
  extensions?: { code?: string; status_code?: number; retry_in_seconds?: number }
  retry_in_seconds?: number
}

interface MondayGraphQLBody<T> {
  data?: T | null
  errors?: MondayGraphQLError[]
  error_message?: string
  error_code?: string
}

/**
 * monday's throttling error codes, matched case-insensitively by substring.
 *
 * The errors page documents `Rate Limit Exceeded`, `COMPLEXITY_BUDGET_EXHAUSTED`
 * and `maxConcurrencyExceeded` as HTTP 429 — which `fetchWithRetry` already
 * retries off the `Retry-After` header — plus `API_TEMPORARILY_BLOCKED` on HTTP
 * 200. The rate-limits page adds `ComplexityException`, `DAILY_LIMIT_EXCEEDED`,
 * `IP_RATE_LIMIT_EXCEEDED`, `Concurrency limit exceeded` and `Minute limit rate
 * exceeded`, none of which carry a documented status.
 *
 * The whole family is matched on an HTTP 200 body and retried here, since the
 * codes without a documented 429 never reach `fetchWithRetry`'s retry path.
 * @see https://developer.monday.com/api-reference/docs/errors
 * @see https://developer.monday.com/api-reference/docs/rate-limits
 */
const MONDAY_THROTTLE_CODE =
  /complexity|rate.?limit|maxconcurrency|concurrency.?limit|daily.?limit|minute.?limit|temporarily_blocked/i

/** Ceiling on an honored `retry_in_seconds`, so a large reset cannot stall a sync. */
const MAX_THROTTLE_WAIT_MS = 60_000

/**
 * Extracts the throttle back-off, in ms, if any GraphQL error in the body is a
 * complexity/rate-limit failure. monday reports the wait as a `retry_in_seconds`
 * body field rather than a `Retry-After` header, so `fetchWithRetry`'s
 * header-driven pacing never sees it.
 */
function throttleRetryMs(errors: MondayGraphQLError[] | undefined): number | null {
  if (!Array.isArray(errors)) return null
  for (const error of errors) {
    const code = error?.extensions?.code
    const isThrottle =
      (typeof code === 'string' && MONDAY_THROTTLE_CODE.test(code)) ||
      error?.extensions?.status_code === 429
    if (!isThrottle) continue
    const seconds = error.retry_in_seconds ?? error.extensions?.retry_in_seconds
    return Number.isFinite(seconds) && Number(seconds) > 0
      ? Math.min(Number(seconds) * 1000, MAX_THROTTLE_WAIT_MS)
      : 0
  }
  return null
}

/** Renders a GraphQL error array into a message that preserves `extensions.code`. */
function formatGraphQLErrors(errors: MondayGraphQLError[]): string {
  const parts = errors
    .map((error) => {
      const code = error?.extensions?.code
      const message = error?.message
      if (code && message) return `${code}: ${message}`
      return code || message || ''
    })
    .filter(Boolean)
  return parts.join('; ') || 'Unknown GraphQL error'
}

/**
 * Executes a GraphQL query against the monday.com API.
 *
 * monday returns `200 – OK` for application-level errors, and those responses may
 * carry a **partially populated** `data` object alongside `errors`. Throwing on any
 * `errors` entry is deliberate: returning the partial payload would let
 * `listDocuments` surface a short or empty item list, which the sync engine would
 * read as "the board has no items" and hard-delete every stored document.
 * @see https://developer.monday.com/api-reference/docs/errors
 */
async function mondayGraphQL<T>(
  accessToken: string,
  query: string,
  variables: Record<string, unknown> = {},
  retryOptions?: Parameters<typeof fetchWithRetry>[2]
): Promise<T> {
  const maxThrottleRetries = retryOptions?.maxRetries ?? 3

  for (let attempt = 1; ; attempt++) {
    const response = await fetchWithRetry(
      MONDAY_API_URL,
      {
        method: 'POST',
        headers: mondayHeaders(accessToken),
        body: JSON.stringify({ query, variables }),
      },
      retryOptions
    )

    if (!response.ok) {
      const errorText = await response.text().catch(() => '')
      throw new Error(
        `monday.com API HTTP error: ${response.status}${errorText ? ` — ${errorText.slice(0, 200)}` : ''}`
      )
    }

    const body = (await response.json()) as MondayGraphQLBody<T>

    const throttleMs = throttleRetryMs(body.errors)
    if (throttleMs !== null && attempt <= maxThrottleRetries) {
      const delayMs = backoffWithJitter(attempt, throttleMs || null, {
        maxMs: MAX_THROTTLE_WAIT_MS,
      })
      logger.warn('Monday.com throttled the request; backing off', { attempt, delayMs })
      await sleep(delayMs)
      continue
    }

    if (body.errors && body.errors.length > 0) {
      throw new Error(`monday.com API error: ${formatGraphQLErrors(body.errors)}`)
    }
    if (body.error_message) {
      const code = body.error_code ? `${body.error_code}: ` : ''
      throw new Error(`monday.com API error: ${code}${body.error_message}`)
    }

    /**
     * No errors but no payload either. Returning `undefined` would let callers
     * read an empty item list off `data.boards`, which reconciles as a deletion
     * of everything the board owns.
     */
    if (body.data === null || body.data === undefined) {
      throw new Error('monday.com API returned no data')
    }

    return body.data
  }
}

/**
 * GraphQL selection set for an item, shared between listing and single-item
 * fetches so the resolved fields stay in sync.
 *
 * `ColumnValue.text` is documented as "not every column supports the text
 * value": mirror, board_relation (connect boards), dependency, and formula
 * columns expose their readable content on `display_value` instead. Mirror and
 * dependency return `null` for `text`; formula returns an empty string. Either
 * way `columnValueText` falls through, but selecting only `text` would silently
 * drop those columns from the indexed document, so each is pulled in via an
 * inline fragment.
 * @see https://developer.monday.com/api-reference/reference/column-values-v2
 * @see https://developer.monday.com/api-reference/reference/mirror
 * @see https://developer.monday.com/api-reference/reference/formula
 * @see https://developer.monday.com/api-reference/reference/dependency
 */
const ITEM_FIELDS = `
  id
  name
  state
  created_at
  updated_at
  url
  board { id name }
  group { id title }
  creator { name }
  column_values {
    id
    text
    column { id title }
    ... on MirrorValue { display_value }
    ... on BoardRelationValue { display_value }
    ... on DependencyValue { display_value }
    ... on FormulaValue { display_value }
  }
  updates(limit: ${UPDATES_LIMIT}) {
    id
    text_body
    created_at
    creator { name }
  }
`

/**
 * Builds the change-detection hash from item identity + last-modified time. Must
 * be identical whether produced inline during listing or via a `getDocument`
 * fetch, since monday's `updated_at` advances on any item or column change.
 */
function buildContentHash(itemId: string, updatedAt: string | null | undefined): string {
  return `monday:${itemId}:${updatedAt ?? ''}`
}

/**
 * Resolves a stable board name + id for an item, preferring the nested `board`
 * field and falling back to the board the item was listed under.
 */
function resolveBoard(
  item: MondayItem,
  fallback?: { id: string; name: string | null }
): { id: string; name: string } {
  const id = item.board?.id ?? fallback?.id ?? ''
  const name = item.board?.name ?? fallback?.name ?? ''
  return { id, name }
}

function buildSourceUrl(item: MondayItem): string | undefined {
  return item.url ?? undefined
}

/**
 * Builds the metadata object carried on every document, used both for tag mapping
 * (`mapTags`) and for downstream display. Kept in one place so listing and
 * single-item fetches emit identical metadata.
 */
function itemMetadata(
  item: MondayItem,
  board: { id: string; name: string }
): Record<string, unknown> {
  return {
    boardId: board.id,
    boardName: board.name,
    itemName: item.name ?? '',
    groupTitle: item.group?.title ?? '',
    state: item.state ?? '',
    creatorName: item.creator?.name ?? '',
    createdAt: item.created_at ?? undefined,
    updatedAt: item.updated_at ?? undefined,
  }
}

/**
 * Produces a fully-hydrated document from a single `items_page` element. The list
 * query already selects the complete item payload (`column_values` + `updates`),
 * so content is built inline here — avoiding a redundant per-item `getDocument`
 * round-trip. `contentHash` derives solely from id + `updated_at`, so it is
 * identical whether produced here or via `getDocument`.
 */
function itemToDocument(
  item: MondayItem,
  fallbackBoard?: { id: string; name: string | null }
): ExternalDocument {
  const board = resolveBoard(item, fallbackBoard)
  return {
    externalId: item.id,
    title: item.name?.trim() || 'Untitled Item',
    content: formatItemContent(item, board),
    contentDeferred: false,
    mimeType: 'text/plain',
    sourceUrl: buildSourceUrl(item),
    contentHash: buildContentHash(item.id, item.updated_at),
    metadata: itemMetadata(item, board),
  }
}

/**
 * Resolves the readable text of a column value, preferring `text` and falling
 * back to `display_value` for the column types that do not populate `text`
 * (mirror, board_relation, dependency, formula).
 */
function columnValueText(cv: MondayColumnValue): string {
  return cv.text?.trim() || cv.display_value?.trim() || ''
}

/**
 * Formats an item's column values and updates into a plain-text document. The
 * resolved board is passed in so listing (which has a board fallback) and
 * single-item fetches produce identical content.
 */
function formatItemContent(item: MondayItem, board: { id: string; name: string }): string {
  const parts: string[] = []

  if (board.name) parts.push(`Board: ${board.name}`)
  parts.push(`Item: ${item.name?.trim() || 'Untitled Item'}`)
  if (item.group?.title) parts.push(`Group: ${item.group.title}`)
  if (item.creator?.name) parts.push(`Created by: ${item.creator.name}`)
  if (item.created_at) parts.push(`Created: ${item.created_at}`)
  if (item.updated_at) parts.push(`Updated: ${item.updated_at}`)

  const fieldLines: string[] = []
  for (const cv of item.column_values) {
    const value = columnValueText(cv)
    if (!value) continue
    fieldLines.push(`${cv.column?.title?.trim() || cv.id}: ${value}`)
  }
  if (fieldLines.length > 0) {
    parts.push('', '--- Fields ---', ...fieldLines)
  }

  const updates = item.updates.filter((u) => u.text_body?.trim())
  if (updates.length > 0) {
    parts.push('')
    parts.push('--- Updates ---')
    for (const update of updates) {
      const author = update.creator?.name?.trim() || 'Unknown'
      parts.push(`Update by ${author}: ${update.text_body}`)
    }
  }

  return parts.join('\n')
}

/**
 * Fetches the list of board ids the connector should sync. When `boardIds` is
 * configured, those are used verbatim; otherwise all accessible active boards
 * are enumerated.
 */
async function resolveBoardIds(
  accessToken: string,
  sourceConfig: Record<string, unknown>,
  syncContext?: Record<string, unknown>
): Promise<{ id: string; name: string | null }[]> {
  const configured = parseMultiValue(sourceConfig.boardIds)
  if (configured.length > 0) {
    return configured.map((id) => ({ id, name: null }))
  }

  const boards: { id: string; name: string | null }[] = []
  let page = 1
  for (; page <= MAX_BOARD_PAGES; page++) {
    const data = await mondayGraphQL<{ boards: { id: string; name: string | null }[] | null }>(
      accessToken,
      `query ($limit: Int!, $page: Int!) {
        boards(limit: $limit, page: $page, state: active) {
          id
          name
        }
      }`,
      { limit: BOARDS_PAGE_SIZE, page }
    )
    const batch = data.boards ?? []
    boards.push(...batch)
    /**
     * `boards` is offset-paginated with no cursor or total count: a short page
     * (or an empty one) is the only exhaustion signal.
     */
    if (batch.length < BOARDS_PAGE_SIZE) return boards
  }

  /**
   * The drain bound was reached with a full final page, so boards beyond it were
   * never enumerated and their items are missing from the listing. Block deletion
   * reconciliation so the sync engine does not hard-delete their stored documents.
   */
  logger.warn('Monday.com board enumeration hit the page bound; listing is incomplete', {
    boardCount: boards.length,
    maxBoardPages: MAX_BOARD_PAGES,
  })
  if (syncContext) syncContext.listingCapped = true
  return boards
}

export const mondayConnector: ConnectorConfig = {
  ...mondayConnectorMeta,

  listDocuments: async (
    accessToken: string,
    sourceConfig: Record<string, unknown>,
    cursor?: string,
    syncContext?: Record<string, unknown>
  ): Promise<ExternalDocumentList> => {
    const maxItems = sourceConfig.maxItems ? Number(sourceConfig.maxItems) : 0
    const state = decodeCursor(cursor)

    const boards =
      (syncContext?.boards as { id: string; name: string | null }[] | undefined) ??
      (await resolveBoardIds(accessToken, sourceConfig, syncContext))
    if (syncContext) syncContext.boards = boards

    if (state.boardIndex >= boards.length) {
      return { documents: [], hasMore: false }
    }

    const board = boards[state.boardIndex]
    const fallbackBoard = { id: board.id, name: board.name }

    const prevFetched = (syncContext?.totalDocsFetched as number) ?? 0
    const pageLimit =
      maxItems > 0
        ? Math.min(ITEMS_PAGE_SIZE, Math.max(1, maxItems - prevFetched))
        : ITEMS_PAGE_SIZE

    let itemsPage: MondayItemsPage | null
    if (state.itemsCursor) {
      const data = await mondayGraphQL<{ next_items_page: MondayItemsPage | null }>(
        accessToken,
        `query ($cursor: String!, $limit: Int!) {
          next_items_page(cursor: $cursor, limit: $limit) {
            cursor
            items { ${ITEM_FIELDS} }
          }
        }`,
        { cursor: state.itemsCursor, limit: pageLimit }
      )
      itemsPage = data.next_items_page
    } else {
      const data = await mondayGraphQL<{ boards: MondayBoard[] | null }>(
        accessToken,
        `query ($ids: [ID!], $limit: Int!) {
          boards(ids: $ids) {
            id
            name
            items_page(limit: $limit) {
              cursor
              items { ${ITEM_FIELDS} }
            }
          }
        }`,
        { ids: [board.id], limit: pageLimit }
      )
      itemsPage = data.boards?.[0]?.items_page ?? null
    }

    const items = itemsPage?.items ?? []
    const nextItemsCursor = itemsPage?.cursor?.trim() || undefined

    logger.info('Listing Monday.com items', {
      boardIndex: state.boardIndex,
      boardTotal: boards.length,
      boardId: board.id,
      itemCount: items.length,
      hasItemsCursor: Boolean(state.itemsCursor),
    })

    const allDocuments = items.map((item) => itemToDocument(item, fallbackBoard))

    let documents = allDocuments
    if (maxItems > 0) {
      const remaining = Math.max(0, maxItems - prevFetched)
      if (allDocuments.length > remaining) {
        documents = allDocuments.slice(0, remaining)
      }
    }

    const totalFetched = prevFetched + documents.length
    if (syncContext) syncContext.totalDocsFetched = totalFetched
    const hitLimit = maxItems > 0 && totalFetched >= maxItems

    /**
     * `listingCapped` blocks the sync engine's deletion reconciliation, so it must
     * only be set when the cap actually hid documents that still exist. A cap that
     * lands exactly on source exhaustion (nothing sliced off this page, no
     * `items_page` cursor, no boards left) is a complete listing and must stay
     * reconcilable — otherwise deleted items are never removed from the KB.
     */
    const moreAvailable =
      documents.length < allDocuments.length ||
      Boolean(nextItemsCursor) ||
      state.boardIndex + 1 < boards.length
    if (hitLimit && moreAvailable && syncContext) syncContext.listingCapped = true

    let nextCursor: string | undefined
    let hasMore = false

    if (hitLimit) {
      nextCursor = undefined
    } else if (nextItemsCursor) {
      nextCursor = encodeCursor({ boardIndex: state.boardIndex, itemsCursor: nextItemsCursor })
      hasMore = true
    } else if (state.boardIndex + 1 < boards.length) {
      nextCursor = encodeCursor({ boardIndex: state.boardIndex + 1 })
      hasMore = true
    }

    return { documents, nextCursor, hasMore }
  },

  getDocument: async (
    accessToken: string,
    _sourceConfig: Record<string, unknown>,
    externalId: string
  ): Promise<ExternalDocument | null> => {
    if (!externalId) return null

    const data = await mondayGraphQL<{ items: MondayItem[] | null }>(
      accessToken,
      `query ($ids: [ID!]) {
        items(ids: $ids) { ${ITEM_FIELDS} }
      }`,
      { ids: [externalId] }
    )

    /**
     * monday answers a deleted or inaccessible id with an empty `items` array
     * rather than an error, so this is the only absence. Every other failure
     * propagates out of `mondayGraphQL` and is recorded by the sync engine as a
     * visible failed document instead of being read as a deletion.
     */
    const item = data.items?.[0]
    if (!item) return null

    return itemToDocument(item)
  },

  validateConfig: async (
    accessToken: string,
    sourceConfig: Record<string, unknown>
  ): Promise<{ valid: boolean; error?: string }> => {
    const maxItems = sourceConfig.maxItems as string | undefined
    if (maxItems && (Number.isNaN(Number(maxItems)) || Number(maxItems) < 0)) {
      return { valid: false, error: 'Max items must be a non-negative number' }
    }

    try {
      await mondayGraphQL(accessToken, `query { me { id } }`, {}, VALIDATE_RETRY_OPTIONS)
      return { valid: true }
    } catch (error) {
      const message = getErrorMessage(error, 'Failed to validate configuration')
      return { valid: false, error: message }
    }
  },

  mapTags: (metadata: Record<string, unknown>): Record<string, unknown> => {
    const result: Record<string, unknown> = {}

    if (typeof metadata.boardName === 'string' && metadata.boardName.trim()) {
      result.boardName = metadata.boardName
    }

    if (typeof metadata.groupTitle === 'string' && metadata.groupTitle.trim()) {
      result.groupTitle = metadata.groupTitle
    }

    if (typeof metadata.itemName === 'string' && metadata.itemName.trim()) {
      result.itemName = metadata.itemName
    }

    if (typeof metadata.state === 'string' && metadata.state.trim()) {
      result.state = metadata.state
    }

    if (typeof metadata.creatorName === 'string' && metadata.creatorName.trim()) {
      result.creatorName = metadata.creatorName
    }

    const createdAt = parseTagDate(metadata.createdAt)
    if (createdAt) result.createdAt = createdAt

    const updatedAt = parseTagDate(metadata.updatedAt)
    if (updatedAt) result.updatedAt = updatedAt

    return result
  },
}
