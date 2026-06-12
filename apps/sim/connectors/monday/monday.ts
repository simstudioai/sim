import { createLogger } from '@sim/logger'
import { getErrorMessage, toError } from '@sim/utils/errors'
import { MondayIcon } from '@/components/icons'
import { fetchWithRetry, VALIDATE_RETRY_OPTIONS } from '@/lib/knowledge/documents/utils'
import type { ConnectorConfig, ExternalDocument, ExternalDocumentList } from '@/connectors/types'
import { parseMultiValue, parseTagDate } from '@/connectors/utils'

const logger = createLogger('MondayConnector')

/**
 * monday.com GraphQL endpoint. All requests are POSTed here.
 * @see https://developer.monday.com/api-reference/docs/basics
 */
const MONDAY_API_URL = 'https://api.monday.com/v2'

/**
 * Stable monday.com API version pinned via the `API-Version` header. monday.com
 * keeps at least three quarterly versions live; `2024-10` was deprecated on
 * 2026-02-15, so this is pinned to the current stable release.
 * @see https://developer.monday.com/api-reference/docs/api-versioning
 */
const MONDAY_API_VERSION = '2026-04'

/** Max items requested per `items_page` / `next_items_page` call (monday.com max is 500). */
const ITEMS_PAGE_SIZE = 100

/** Max boards requested per `boards` listing page (monday.com max is 500). */
const BOARDS_PAGE_SIZE = 100

/** Max updates fetched per item for content extraction. */
const UPDATES_LIMIT = 50

interface MondayColumnValue {
  id: string
  text: string | null
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

/**
 * monday.com uses the raw access token in the `Authorization` header — it is NOT
 * prefixed with "Bearer". The `API-Version` header pins the schema version.
 * @see https://developer.monday.com/api-reference/docs/authentication
 */
function mondayHeaders(accessToken: string): Record<string, string> {
  return {
    'Content-Type': 'application/json',
    Authorization: accessToken,
    'API-Version': MONDAY_API_VERSION,
  }
}

/**
 * Executes a GraphQL query against the monday.com API, surfacing GraphQL-level
 * errors (which return HTTP 200 with an `errors` array) as thrown errors.
 */
async function mondayGraphQL<T>(
  accessToken: string,
  query: string,
  variables: Record<string, unknown> = {},
  retryOptions?: Parameters<typeof fetchWithRetry>[2]
): Promise<T> {
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

  const data = (await response.json()) as {
    data?: T
    errors?: { message?: string }[]
    error_message?: string
  }

  if (data.errors && data.errors.length > 0) {
    const message = data.errors
      .map((e) => e.message)
      .filter(Boolean)
      .join('; ')
    throw new Error(`monday.com API error: ${message || 'Unknown GraphQL error'}`)
  }
  if (data.error_message) {
    throw new Error(`monday.com API error: ${data.error_message}`)
  }

  return data.data as T
}

/**
 * GraphQL selection set for an item, shared between listing and single-item
 * fetches so the resolved fields stay in sync.
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

  const columns = item.column_values.filter((cv) => cv.text?.trim())
  if (columns.length > 0) {
    parts.push('')
    parts.push('--- Fields ---')
    for (const cv of columns) {
      const title = cv.column?.title?.trim() || cv.id
      parts.push(`${title}: ${cv.text}`)
    }
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
  sourceConfig: Record<string, unknown>
): Promise<{ id: string; name: string | null }[]> {
  const configured = parseMultiValue(sourceConfig.boardIds)
  if (configured.length > 0) {
    return configured.map((id) => ({ id, name: null }))
  }

  const boards: { id: string; name: string | null }[] = []
  let page = 1
  for (;;) {
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
    if (batch.length < BOARDS_PAGE_SIZE) break
    page += 1
  }
  return boards
}

export const mondayConnector: ConnectorConfig = {
  id: 'monday',
  name: 'Monday.com',
  description: 'Sync board items and updates from Monday.com into your knowledge base',
  version: '1.0.0',
  icon: MondayIcon,

  auth: {
    mode: 'oauth',
    provider: 'monday',
    requiredScopes: ['boards:read', 'updates:read', 'me:read'],
  },

  configFields: [
    {
      id: 'boardIds',
      title: 'Board IDs',
      type: 'short-input',
      required: false,
      placeholder: 'e.g. 1234567890, 9876543210 (empty = all active boards)',
      description:
        'Comma-separated board IDs to sync — find a board ID in its URL (.../boards/<id>). Leave empty to sync items from every active board you can access.',
    },
    {
      id: 'maxItems',
      title: 'Max Items',
      type: 'short-input',
      required: false,
      placeholder: 'e.g. 500 (default: unlimited)',
    },
  ],

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
      (await resolveBoardIds(accessToken, sourceConfig))
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
    if (hitLimit && syncContext) syncContext.listingCapped = true

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
    try {
      if (!externalId) return null

      const data = await mondayGraphQL<{ items: MondayItem[] | null }>(
        accessToken,
        `query ($ids: [ID!]) {
          items(ids: $ids) { ${ITEM_FIELDS} }
        }`,
        { ids: [externalId] }
      )

      const item = data.items?.[0]
      if (!item) return null

      const doc = itemToDocument(item)
      if (!doc.content.trim()) return null

      return doc
    } catch (error) {
      logger.warn('Failed to get Monday.com item', {
        externalId,
        error: toError(error).message,
      })
      return null
    }
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

  tagDefinitions: [
    { id: 'boardName', displayName: 'Board', fieldType: 'text' },
    { id: 'groupTitle', displayName: 'Group', fieldType: 'text' },
    { id: 'itemName', displayName: 'Item', fieldType: 'text' },
    { id: 'state', displayName: 'State', fieldType: 'text' },
    { id: 'creatorName', displayName: 'Creator', fieldType: 'text' },
    { id: 'createdAt', displayName: 'Created', fieldType: 'date' },
    { id: 'updatedAt', displayName: 'Last Updated', fieldType: 'date' },
  ],

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
