import { createLogger } from '@sim/logger'
import { getErrorMessage, toError } from '@sim/utils/errors'
import { env } from '@/lib/core/config/env'
import { fetchWithRetry, VALIDATE_RETRY_OPTIONS } from '@/lib/knowledge/documents/utils'
import { trelloConnectorMeta } from '@/connectors/trello/meta'
import type { ConnectorConfig, ExternalDocument, ExternalDocumentList } from '@/connectors/types'
import { joinTagArray, parseMultiValue, parseTagDate } from '@/connectors/utils'

const logger = createLogger('TrelloConnector')

/**
 * Trello REST API base. Every request authenticates with the Sim application
 * `key` plus the user's OAuth `token` as query parameters — Trello does not
 * accept a bearer header.
 * @see https://developer.atlassian.com/cloud/trello/guides/rest-api/authorization/
 */
const TRELLO_API_BASE_URL = 'https://api.trello.com/1'

/**
 * Card fields requested when listing. Kept in sync with the single-card fetch so
 * the stub and the hydrated document describe the same card. `badges` carries the
 * comment/checklist/attachment counters that feed the change-detection hash.
 * @see https://developer.atlassian.com/cloud/trello/guides/rest-api/object-definitions/
 */
const CARD_FIELDS =
  'id,name,desc,url,shortUrl,closed,due,dueComplete,dateLastActivity,idList,idBoard,labels,badges'

/**
 * Hard ceiling Trello applies to a long collection: "the Trello API limits you
 * to at most 1000 results", with `before`/`since` documented as the way to page
 * past it. It is both the page size requested for cards and the size at which
 * any cursor-less collection response (boards, lists) is assumed truncated —
 * neither the ordering of `GET /lists/{id}/cards` nor which 1000 results `limit`
 * keeps is documented, so a collection that reaches the ceiling is reported as
 * capped rather than letting deletion reconciliation purge the part of it this
 * run could not reach.
 * @see https://developer.atlassian.com/cloud/trello/guides/rest-api/api-introduction/
 */
const TRELLO_COLLECTION_LIMIT = 1000

/**
 * Soft per-call document target. Trello has no board-wide card cursor, so the
 * listing walks board → list → card page. Emitting one list per call would burn
 * one sync-engine page per list and hit its `MAX_PAGES` ceiling on workspaces
 * with many small lists, which permanently truncates the listing.
 */
const CARD_TARGET_PER_CALL = 500

/** Maximum comment actions requested for, and rendered into, a card's content. */
const COMMENT_LIMIT = 50

/**
 * Upper bound on Trello requests issued by a single `listDocuments` call. The
 * traversal is board → list → card page, so a workspace made of many small or
 * empty lists would otherwise issue thousands of sequential requests inside one
 * call and exhaust the sync task's time budget before returning a single page.
 */
const MAX_REQUESTS_PER_CALL = 40

/** Concurrency used when resolving names for explicitly configured boards. */
const BOARD_LOOKUP_CONCURRENCY = 4

interface TrelloLabel {
  id?: string
  name?: string | null
  color?: string | null
}

interface TrelloBadges {
  comments?: number | null
  checkItems?: number | null
  checkItemsChecked?: number | null
  attachments?: number | null
  description?: boolean | null
}

interface TrelloAttachment {
  id?: string
  name?: string | null
  url?: string | null
}

interface TrelloMember {
  id?: string
  fullName?: string | null
  username?: string | null
}

interface TrelloCard {
  id: string
  name?: string | null
  desc?: string | null
  url?: string | null
  shortUrl?: string | null
  closed?: boolean | null
  due?: string | null
  dueComplete?: boolean | null
  dateLastActivity?: string | null
  idList?: string | null
  idBoard?: string | null
  labels?: TrelloLabel[] | null
  badges?: TrelloBadges | null
  board?: { id?: string | null; name?: string | null } | null
  list?: { id?: string | null; name?: string | null } | null
  actions?: TrelloAction[] | null
  attachments?: TrelloAttachment[] | null
  members?: TrelloMember[] | null
}

interface TrelloAction {
  id?: string
  type?: string | null
  date?: string | null
  data?: { text?: string | null } | null
  memberCreator?: { fullName?: string | null; username?: string | null } | null
}

interface TrelloChecklistItem {
  id?: string
  name?: string | null
  state?: string | null
}

interface TrelloChecklist {
  id?: string
  name?: string | null
  checkItems?: TrelloChecklistItem[] | null
}

interface TrelloBoardRef {
  id: string
  name?: string | null
}

interface TrelloListRef {
  id: string
  name?: string | null
}

/**
 * Pagination state encoded into `nextCursor`: which board of the resolved set is
 * being read, which of that board's lists is being read, and — when that list
 * holds more cards than one request can return — the id of the oldest card
 * already emitted, replayed as the `before` bound for the next request.
 */
interface CursorState {
  boardIndex: number
  listIndex: number
  beforeId?: string
}

function encodeCursor(state: CursorState): string {
  return Buffer.from(JSON.stringify(state), 'utf8').toString('base64url')
}

function decodeCursor(cursor?: string): CursorState {
  if (!cursor) return { boardIndex: 0, listIndex: 0 }
  try {
    const parsed = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8')) as
      | Partial<CursorState>
      | undefined
    return {
      boardIndex: Number(parsed?.boardIndex) || 0,
      listIndex: Number(parsed?.listIndex) || 0,
      beforeId: typeof parsed?.beforeId === 'string' ? parsed.beforeId : undefined,
    }
  } catch {
    return { boardIndex: 0, listIndex: 0 }
  }
}

/**
 * Raised when a Trello request fails, carrying the HTTP status so callers can
 * distinguish a deleted card (404) from a transport or permission failure.
 */
class TrelloApiError extends Error {
  constructor(
    message: string,
    readonly status: number
  ) {
    super(message)
    this.name = 'TrelloApiError'
  }
}

/**
 * Reads Sim's Trello application key. Trello binds every OAuth token to the key
 * that issued it, so requests are unauthenticated without both halves.
 */
function requireApiKey(): string {
  const apiKey = env.TRELLO_API_KEY
  if (!apiKey) {
    throw new Error('TRELLO_API_KEY environment variable is not set')
  }
  return apiKey
}

/**
 * Performs an authenticated GET against the Trello REST API and parses the JSON
 * body. `params` values are appended verbatim; `key` and `token` are always added.
 */
async function trelloGet<T>(
  accessToken: string,
  path: string,
  params: Record<string, string> = {},
  retryOptions?: Parameters<typeof fetchWithRetry>[2]
): Promise<T> {
  const url = new URL(`${TRELLO_API_BASE_URL}${path}`)
  for (const [name, value] of Object.entries(params)) {
    url.searchParams.set(name, value)
  }
  url.searchParams.set('key', requireApiKey())
  url.searchParams.set('token', accessToken)

  const response = await fetchWithRetry(
    url.toString(),
    { method: 'GET', headers: { Accept: 'application/json' } },
    retryOptions
  )

  if (!response.ok) {
    const errorText = await response.text().catch(() => '')
    throw new TrelloApiError(
      `Trello API error: ${response.status}${errorText ? ` — ${errorText.slice(0, 200)}` : ''}`,
      response.status
    )
  }

  return (await response.json()) as T
}

/**
 * Normalizes the configured card scope. Trello's cards nested resource accepts
 * `all`, `closed`, `none`, `open`, and `visible`; this connector exposes only the
 * two meaningful read scopes and defaults to open cards.
 */
function resolveCardFilter(sourceConfig: Record<string, unknown>): 'open' | 'all' {
  return sourceConfig.cardFilter === 'all' ? 'all' : 'open'
}

/**
 * Resolves the boards to sync. Explicitly configured board IDs are looked up so
 * their names are available for tagging; otherwise every open board the member
 * belongs to is enumerated.
 * @see https://developer.atlassian.com/cloud/trello/rest/api-group-members/#api-members-id-boards-get
 */
async function resolveBoards(
  accessToken: string,
  sourceConfig: Record<string, unknown>
): Promise<TrelloBoardRef[]> {
  const configured = parseMultiValue(sourceConfig.boardIds)
  if (configured.length > 0) {
    const resolved: TrelloBoardRef[] = []
    for (let index = 0; index < configured.length; index += BOARD_LOOKUP_CONCURRENCY) {
      const batch = configured.slice(index, index + BOARD_LOOKUP_CONCURRENCY)
      const settled = await Promise.all(
        batch.map(async (id): Promise<TrelloBoardRef> => {
          try {
            const board = await trelloGet<TrelloBoardRef>(
              accessToken,
              `/boards/${encodeURIComponent(id)}`,
              { fields: 'id,name' }
            )
            return { id, name: board?.name ?? null }
          } catch (error) {
            logger.warn('Failed to resolve Trello board name', {
              boardId: id,
              error: toError(error).message,
            })
            return { id }
          }
        })
      )
      resolved.push(...settled)
    }
    return resolved
  }

  const boards = await trelloGet<TrelloBoardRef[]>(accessToken, '/members/me/boards', {
    filter: 'open',
    fields: 'id,name',
  })
  return Array.isArray(boards) ? boards.filter((board) => Boolean(board?.id)) : []
}

/**
 * Fetches a board's lists. The list scope tracks the configured card scope so
 * "All cards (including archived)" also reaches cards sitting in archived lists,
 * which an `open`-only list filter would hide entirely.
 * @see https://developer.atlassian.com/cloud/trello/rest/api-group-boards/#api-boards-id-lists-get
 */
async function listBoardLists(
  accessToken: string,
  boardId: string,
  cardFilter: 'open' | 'all'
): Promise<TrelloListRef[]> {
  const lists = await trelloGet<TrelloListRef[]>(
    accessToken,
    `/boards/${encodeURIComponent(boardId)}/lists`,
    { filter: cardFilter === 'all' ? 'all' : 'open', fields: 'id,name' }
  )
  return Array.isArray(lists) ? lists.filter((list) => Boolean(list?.id)) : []
}

function labelNames(card: TrelloCard): string[] {
  if (!Array.isArray(card.labels)) return []
  return card.labels
    .map((label) => label?.name?.trim() || label?.color?.trim() || '')
    .filter((name) => name.length > 0)
}

/**
 * Change-detection hash.
 *
 * `dateLastActivity` alone is not a sufficient change signal: Trello documents
 * neither which events bump it nor any guarantee that every content-bearing
 * event does, and comment/checklist edits are rendered into the document body.
 * The `badges` counters — comment count, checklist item counts, attachment count
 * and the description flag — come back with the listing at no extra request cost
 * and change whenever those bodies change, so they are folded in as a
 * belt-and-braces signal. Must be produced identically by the stub and the
 * hydrated document.
 */
function buildContentHash(card: TrelloCard): string {
  const badges = card.badges ?? {}
  const counters = [
    badges.comments ?? 0,
    badges.checkItems ?? 0,
    badges.checkItemsChecked ?? 0,
    badges.attachments ?? 0,
    badges.description === true ? 1 : 0,
  ].join('.')
  return `trello:${card.id}:${card.dateLastActivity ?? ''}:${counters}`
}

/**
 * Metadata carried on every document and fed to `mapTags`. Board and list names
 * are passed in because the listing resolves them from its traversal while the
 * single-card fetch resolves them from the expanded `board`/`list` objects.
 */
function cardMetadata(
  card: TrelloCard,
  boardName: string,
  listName: string
): Record<string, unknown> {
  return {
    boardId: card.idBoard ?? '',
    boardName,
    listId: card.idList ?? '',
    listName,
    labels: labelNames(card),
    closed: card.closed === true,
    due: card.due ?? undefined,
    lastActivity: card.dateLastActivity ?? undefined,
  }
}

/**
 * Builds the lightweight listing stub. Content is deferred because checklists and
 * comments each require their own per-card request.
 */
function cardToStub(card: TrelloCard, boardName: string, listName: string): ExternalDocument {
  return {
    externalId: card.id,
    title: card.name?.trim() || 'Untitled Card',
    content: '',
    contentDeferred: true,
    mimeType: 'text/plain',
    sourceUrl: card.url ?? card.shortUrl ?? undefined,
    contentHash: buildContentHash(card),
    metadata: cardMetadata(card, boardName, listName),
  }
}

/**
 * Renders a card, its description, checklists, attachments, members, and comments
 * as plain text. Trello returns description and comment text as Markdown, never
 * HTML, so no HTML stripping is applied.
 */
function buildCardContent(
  card: TrelloCard,
  boardName: string,
  listName: string,
  checklists: TrelloChecklist[],
  comments: TrelloAction[]
): string {
  const parts: string[] = []

  if (boardName) parts.push(`Board: ${boardName}`)
  if (listName) parts.push(`List: ${listName}`)
  parts.push(`Card: ${card.name?.trim() || 'Untitled Card'}`)

  const labels = labelNames(card)
  if (labels.length > 0) parts.push(`Labels: ${labels.join(', ')}`)

  const members = (Array.isArray(card.members) ? card.members : [])
    .map((member) => member?.fullName?.trim() || member?.username?.trim() || '')
    .filter((name) => name.length > 0)
  if (members.length > 0) parts.push(`Members: ${members.join(', ')}`)

  if (card.due) parts.push(`Due: ${card.due}${card.dueComplete === true ? ' (complete)' : ''}`)
  if (card.closed === true) parts.push('Archived: Yes')

  const description = card.desc?.trim()
  if (description) {
    parts.push('')
    parts.push('--- Description ---')
    parts.push(description)
  }

  const populatedChecklists = checklists.filter(
    (checklist) => (checklist.checkItems?.length ?? 0) > 0
  )
  if (populatedChecklists.length > 0) {
    parts.push('')
    parts.push('--- Checklists ---')
    for (const checklist of populatedChecklists) {
      parts.push(`${checklist.name?.trim() || 'Checklist'}:`)
      for (const item of checklist.checkItems ?? []) {
        const name = item.name?.trim()
        if (!name) continue
        parts.push(`- [${item.state === 'complete' ? 'x' : ' '}] ${name}`)
      }
    }
  }

  const attachments = (Array.isArray(card.attachments) ? card.attachments : []).filter(
    (attachment) => attachment?.name?.trim() || attachment?.url?.trim()
  )
  if (attachments.length > 0) {
    parts.push('')
    parts.push('--- Attachments ---')
    for (const attachment of attachments) {
      const name = attachment.name?.trim()
      const url = attachment.url?.trim()
      parts.push(name && url ? `- ${name}: ${url}` : `- ${name || url}`)
    }
  }

  const populatedComments = comments.filter((comment) => comment.data?.text?.trim())
  if (populatedComments.length > 0) {
    parts.push('')
    parts.push('--- Comments ---')
    for (const comment of populatedComments) {
      const author =
        comment.memberCreator?.fullName?.trim() ||
        comment.memberCreator?.username?.trim() ||
        'Unknown'
      parts.push(`Comment by ${author}: ${comment.data?.text?.trim()}`)
    }
  }

  return parts.join('\n')
}

/**
 * Reads a board's lists once per sync run. The listing walks a board across
 * several pages, so re-fetching its lists on every page would multiply requests
 * and risk an inconsistent traversal mid-sync.
 */
async function getCachedLists(
  accessToken: string,
  boardId: string,
  cardFilter: 'open' | 'all',
  syncContext: Record<string, unknown> | undefined
): Promise<{ lists: TrelloListRef[]; fetched: boolean }> {
  const cacheKey = `lists:${boardId}`
  const cached = syncContext?.[cacheKey] as TrelloListRef[] | undefined
  if (cached) return { lists: cached, fetched: false }

  const lists = await listBoardLists(accessToken, boardId, cardFilter)
  if (syncContext) syncContext[cacheKey] = lists
  return { lists, fetched: true }
}

export const trelloConnector: ConnectorConfig = {
  ...trelloConnectorMeta,

  listDocuments: async (
    accessToken: string,
    sourceConfig: Record<string, unknown>,
    cursor?: string,
    syncContext?: Record<string, unknown>
  ): Promise<ExternalDocumentList> => {
    const maxCards = sourceConfig.maxCards ? Number(sourceConfig.maxCards) : 0
    const cardFilter = resolveCardFilter(sourceConfig)
    const state = decodeCursor(cursor)

    const markCapped = () => {
      if (syncContext) syncContext.listingCapped = true
    }

    const cachedBoards = syncContext?.boards as TrelloBoardRef[] | undefined
    const boards = cachedBoards ?? (await resolveBoards(accessToken, sourceConfig))
    if (syncContext) syncContext.boards = boards

    /**
     * `GET /members/me/boards` has no cursor, so a response at Trello's
     * collection ceiling hides the remaining boards. Their cards would be absent
     * from the listing and look deleted, so reconciliation is withheld. Checked
     * only on the call that resolved them, since the flag persists on
     * `syncContext` for the rest of the run.
     */
    if (!cachedBoards && boards.length >= TRELLO_COLLECTION_LIMIT) {
      logger.warn('Trello board listing hit the collection ceiling; boards may be missing', {
        boardCount: boards.length,
      })
      markCapped()
    }

    const documents: ExternalDocument[] = []
    const previouslyFetched = (syncContext?.totalDocsFetched as number) ?? 0
    let boardIndex = state.boardIndex
    let listIndex = state.listIndex
    let beforeId = state.beforeId
    let hitLimit = false
    let requestsUsed = 0

    while (boardIndex < boards.length) {
      if (documents.length >= CARD_TARGET_PER_CALL || requestsUsed >= MAX_REQUESTS_PER_CALL) break

      const board = boards[boardIndex]
      const boardName = board.name?.trim() ?? ''

      /**
       * A list-level failure would drop still-existing cards from the listing, so
       * the board is skipped and the listing is marked capped rather than letting
       * deletion reconciliation purge those documents.
       */
      let lists: TrelloListRef[]
      try {
        const result = await getCachedLists(accessToken, board.id, cardFilter, syncContext)
        lists = result.lists
        if (result.fetched) {
          requestsUsed += 1
          /**
           * `GET /boards/{id}/lists` has no cursor either, so a response at the
           * collection ceiling hides the remaining lists and their cards.
           */
          if (lists.length >= TRELLO_COLLECTION_LIMIT) {
            logger.warn('Trello list listing hit the collection ceiling; lists may be missing', {
              boardId: board.id,
              listCount: lists.length,
            })
            markCapped()
          }
        }
      } catch (error) {
        requestsUsed += 1
        logger.warn('Failed to list Trello lists for board', {
          boardId: board.id,
          error: toError(error).message,
        })
        markCapped()
        boardIndex += 1
        listIndex = 0
        beforeId = undefined
        continue
      }

      if (listIndex >= lists.length) {
        boardIndex += 1
        listIndex = 0
        beforeId = undefined
        continue
      }

      const list = lists[listIndex]
      const listName = list.name?.trim() ?? ''

      let cards: TrelloCard[]
      requestsUsed += 1
      try {
        cards = await trelloGet<TrelloCard[]>(
          accessToken,
          `/lists/${encodeURIComponent(list.id)}/cards`,
          {
            filter: cardFilter,
            fields: CARD_FIELDS,
            limit: String(TRELLO_COLLECTION_LIMIT),
            ...(beforeId ? { before: beforeId } : {}),
          }
        )
      } catch (error) {
        logger.warn('Failed to list Trello cards', {
          boardId: board.id,
          listId: list.id,
          error: toError(error).message,
        })
        markCapped()
        listIndex += 1
        beforeId = undefined
        continue
      }

      const rawCards = (Array.isArray(cards) ? cards : []).filter((card) => Boolean(card?.id))
      const pageFull = rawCards.length >= TRELLO_COLLECTION_LIMIT

      /**
       * Trello's `before` bound is a creation date derived from the id, so it is
       * only second-granular and a card created in the same second as the bound
       * can come back again. Card ids are Mongo ObjectIds whose leading four
       * bytes are the big-endian creation timestamp, so lowercase hex ordering
       * is creation ordering down to the second and total (arbitrary but stable)
       * within a second — enough to drop anything not strictly older than the
       * bound as already emitted.
       */
      const bound = beforeId
      const newCards = bound ? rawCards.filter((card) => card.id < bound) : rawCards

      let oldestId: string | undefined
      for (const card of newCards) {
        if (!oldestId || card.id < oldestId) oldestId = card.id
      }

      let stubs = newCards.map((card) => cardToStub(card, boardName, listName))

      let slicedByCap = false
      if (maxCards > 0) {
        const remaining = Math.max(0, maxCards - previouslyFetched - documents.length)
        if (stubs.length > remaining) {
          stubs = stubs.slice(0, remaining)
          slicedByCap = true
        }
      }

      documents.push(...stubs)

      if (pageFull && oldestId && (!beforeId || oldestId < beforeId)) {
        /**
         * Paging past Trello's 1000-result ceiling with `before` is only complete
         * if the truncated response is the newest 1000 of the collection. Trello
         * documents neither the ordering of `GET /lists/{id}/cards` nor which
         * 1000 results `limit` keeps, so a card newer than the bound but absent
         * from the previous response is unreachable and would look deleted. The
         * listing is therefore reported as capped for any list that needs a
         * second request — the cards are still collected, but deletion
         * reconciliation is withheld until a deliberate full resync.
         */
        markCapped()
        beforeId = oldestId
      } else {
        if (pageFull) {
          /**
           * The page came back full yet yielded no strictly-older card, so
           * `before` cannot advance and the rest of this list is unreachable.
           */
          logger.warn('Trello list pagination stalled; remaining cards unreachable', {
            boardId: board.id,
            listId: list.id,
          })
          markCapped()
        }
        listIndex += 1
        beforeId = undefined
      }

      if (maxCards > 0 && previouslyFetched + documents.length >= maxCards) {
        hitLimit = true
        /**
         * The cap only truncates the listing when source cards were actually
         * left behind. Reaching the cap exactly at source exhaustion is a
         * complete listing and must stay eligible for deletion reconciliation.
         */
        const moreRemains =
          slicedByCap ||
          beforeId !== undefined ||
          listIndex < lists.length ||
          boardIndex + 1 < boards.length
        if (moreRemains) markCapped()
        break
      }
    }

    const totalFetched = previouslyFetched + documents.length
    if (syncContext) syncContext.totalDocsFetched = totalFetched

    const exhausted = hitLimit || boardIndex >= boards.length
    const nextCursor = exhausted ? undefined : encodeCursor({ boardIndex, listIndex, beforeId })

    logger.info('Listing Trello cards', {
      boardIndex,
      boardTotal: boards.length,
      listIndex,
      cardCount: documents.length,
      totalFetched,
    })

    return { documents, nextCursor, hasMore: !exhausted }
  },

  getDocument: async (
    accessToken: string,
    _sourceConfig: Record<string, unknown>,
    externalId: string
  ): Promise<ExternalDocument | null> => {
    if (!externalId) return null

    const cardId = encodeURIComponent(externalId)

    try {
      const card = await trelloGet<TrelloCard>(accessToken, `/cards/${cardId}`, {
        fields: CARD_FIELDS,
        board: 'true',
        board_fields: 'id,name',
        list: 'true',
        actions: 'commentCard',
        actions_limit: String(COMMENT_LIMIT),
        attachments: 'true',
        attachment_fields: 'name,url',
        members: 'true',
        member_fields: 'fullName,username',
      })

      if (!card?.id) return null

      const boardName = card.board?.name?.trim() ?? ''
      const listName = card.list?.name?.trim() ?? ''

      /**
       * Checklists come from their own endpoint so `checkItems` are explicitly
       * requested. A failure here degrades content rather than dropping the card.
       */
      let checklists: TrelloChecklist[] = []
      try {
        const fetched = await trelloGet<TrelloChecklist[]>(
          accessToken,
          `/cards/${cardId}/checklists`,
          { checkItems: 'all', checkItem_fields: 'name,state', fields: 'name' }
        )
        if (Array.isArray(fetched)) checklists = fetched
      } catch (error) {
        logger.warn('Failed to fetch Trello checklists', {
          externalId,
          error: toError(error).message,
        })
      }

      const comments = (Array.isArray(card.actions) ? card.actions : []).filter(
        (action) => action?.type === 'commentCard'
      )

      /**
       * `actions_limit` caps the nested actions Trello returns, so `card.actions`
       * can never hold more than `COMMENT_LIMIT` comments and the shortfall is
       * invisible in the array itself. `badges.comments` is the card's true
       * comment count and arrives on the same request, so it is what detects the
       * truncation.
       */
      const totalComments = card.badges?.comments ?? 0
      if (totalComments > COMMENT_LIMIT) {
        logger.warn('Trello card comments truncated', {
          externalId,
          commentLimit: COMMENT_LIMIT,
          commentCount: totalComments,
        })
      }

      return {
        externalId: card.id,
        title: card.name?.trim() || 'Untitled Card',
        content: buildCardContent(card, boardName, listName, checklists, comments),
        contentDeferred: false,
        mimeType: 'text/plain',
        sourceUrl: card.url ?? card.shortUrl ?? undefined,
        contentHash: buildContentHash(card),
        metadata: cardMetadata(card, boardName, listName),
      }
    } catch (error) {
      /**
       * Only a deleted card resolves to `null`. Any other failure is rethrown so
       * the sync engine records a failed row — swallowing it would drop the card
       * from the run silently while leaving its stored copy stale.
       */
      if (error instanceof TrelloApiError && error.status === 404) return null
      logger.warn('Failed to get Trello card', {
        externalId,
        error: toError(error).message,
      })
      throw toError(error)
    }
  },

  validateConfig: async (
    accessToken: string,
    sourceConfig: Record<string, unknown>
  ): Promise<{ valid: boolean; error?: string }> => {
    const maxCards = sourceConfig.maxCards as string | undefined
    if (maxCards && (Number.isNaN(Number(maxCards)) || Number(maxCards) < 0)) {
      return { valid: false, error: 'Max cards must be a non-negative number' }
    }

    const cardFilter = sourceConfig.cardFilter
    if (cardFilter != null && cardFilter !== '' && cardFilter !== 'open' && cardFilter !== 'all') {
      return { valid: false, error: 'Cards must be either "open" or "all"' }
    }

    if (!env.TRELLO_API_KEY) {
      return {
        valid: false,
        error: 'Trello is not configured on this deployment (missing Trello application key)',
      }
    }

    try {
      await trelloGet(accessToken, '/members/me', { fields: 'id' }, VALIDATE_RETRY_OPTIONS)

      for (const boardId of parseMultiValue(sourceConfig.boardIds)) {
        await trelloGet(
          accessToken,
          `/boards/${encodeURIComponent(boardId)}`,
          { fields: 'id' },
          VALIDATE_RETRY_OPTIONS
        )
      }

      return { valid: true }
    } catch (error) {
      return { valid: false, error: getErrorMessage(error, 'Failed to validate configuration') }
    }
  },

  mapTags: (metadata: Record<string, unknown>): Record<string, unknown> => {
    const result: Record<string, unknown> = {}

    if (typeof metadata.boardName === 'string' && metadata.boardName.trim()) {
      result.boardName = metadata.boardName
    }

    if (typeof metadata.listName === 'string' && metadata.listName.trim()) {
      result.listName = metadata.listName
    }

    const labels = joinTagArray(metadata.labels)
    if (labels) result.labels = labels

    if (typeof metadata.closed === 'boolean') result.closed = metadata.closed

    const due = parseTagDate(metadata.due)
    if (due) result.due = due

    const lastActivity = parseTagDate(metadata.lastActivity)
    if (lastActivity) result.lastActivity = lastActivity

    return result
  },
}
