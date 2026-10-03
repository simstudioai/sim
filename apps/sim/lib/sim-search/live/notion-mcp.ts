import {
  dateSortDirection,
  hasDateBounds,
  nativeDateBounds,
  nativeText,
} from '@/lib/sim-search/live/dates'
import { array, NativeSearchError, object, string } from '@/lib/sim-search/live/http'
import type { ManagedSearchMcpClient } from '@/lib/sim-search/live/managed-mcp'
import type { NativeDocument, NativePage, NativeSearchInput } from '@/lib/sim-search/live/types'

const UUID = /^[\da-f]{8}-[\da-f]{4}-[\da-f]{4}-[\da-f]{4}-[\da-f]{12}$/i
const COMPACT_UUID = /^[\da-f]{32}$/i
const PAGE_KINDS = new Set(['page', 'database', 'data_source', 'block', 'notion'])

function pageId(value: string): string | undefined {
  if (UUID.test(value)) return value.toLowerCase()
  if (!COMPACT_UUID.test(value)) return undefined
  return `${value.slice(0, 8)}-${value.slice(8, 12)}-${value.slice(12, 16)}-${value.slice(16, 20)}-${value.slice(20)}`.toLowerCase()
}

function notionResource(value: string): { id: string; url: string } | undefined {
  const id = pageId(value)
  if (id) return { id, url: `https://www.notion.so/${id.replaceAll('-', '')}` }
  try {
    const url = new URL(value)
    if (
      url.protocol !== 'https:' ||
      url.username ||
      url.password ||
      url.port ||
      !(
        ['notion.so', 'www.notion.so', 'app.notion.com', 'notion.site'].includes(url.hostname) ||
        url.hostname.endsWith('.notion.site')
      )
    )
      return undefined
    const tail = url.pathname.split('/').filter(Boolean).at(-1) ?? ''
    const resourceId = pageId(tail) ?? pageId(tail.slice(-32))
    return resourceId ? { id: resourceId, url: url.toString() } : undefined
  } catch {
    return undefined
  }
}

function modifiedDate(row: Record<string, unknown>): string | undefined {
  const value = string(row.page_last_edited_at ?? row.last_edited_time ?? row.last_edited_at)
  return value && Number.isFinite(Date.parse(value)) ? value : undefined
}

function searchDocument(row: Record<string, unknown>): NativeDocument | undefined {
  const resource = notionResource(string(row.url))
  if (!resource) return undefined
  const source = typeof row.source === 'string' ? row.source : string(object(row.source).type)
  if (source && source.toLowerCase() !== 'notion') return undefined
  const kind = string(row.type)
  if (kind && !PAGE_KINDS.has(kind)) return undefined
  if (row.id !== undefined && pageId(string(row.id)) !== resource.id) return undefined
  return {
    ...resource,
    kind: 'mcp',
    title: string(row.title) || 'Notion page',
    content: string(row.highlight ?? row.snippet ?? row.content) || string(row.title),
    modifiedAt: modifiedDate(row),
  }
}

const BROWSE_TOOLS = {
  private: 'notion-list-private-pages',
  shared: 'notion-list-shared-pages',
  favorites: 'notion-list-favorite-pages',
  recent: 'notion-list-recent-pages',
} as const

/** Tool visibility and workspace-plan access are separate; the current access map owns routing. */
async function searchTool(
  client: ManagedSearchMcpClient,
  browse?: NativeSearchInput['native']
): Promise<{ tool: string; restrictions: Record<string, unknown> }> {
  const access = object(object(await client.call('notion-get-tool-access', {})).current_tool_access)
  if (browse?.browse) {
    if (!(browse.browse in BROWSE_TOOLS))
      throw new NativeSearchError('unavailable', 'Unsupported Notion browse mode.')
    const name = BROWSE_TOOLS[browse.browse as keyof typeof BROWSE_TOOLS]
    const entry = object(access[name.replace('notion-', '').replaceAll('-', '_')])
    if (
      client.hasTool?.(name) !== true ||
      !['available', 'available_with_limit'].includes(string(entry.status))
    )
      throw new NativeSearchError(
        'unavailable',
        'Notion browsing is unavailable for this connection.'
      )
    return { tool: name, restrictions: object(entry.restricted_parameters) }
  }
  const ai = object(access.ai_search)
  const keyword = object(access.search)
  const exposed = (name: string) => client.hasTool?.(name) !== false
  if (ai.status === 'available' && exposed('notion-ai-search'))
    return { tool: 'notion-ai-search', restrictions: object(ai.restricted_parameters) }
  if (
    ['available', 'available_with_limit'].includes(string(keyword.status)) &&
    exposed('notion-search')
  )
    return { tool: 'notion-search', restrictions: object(keyword.restricted_parameters) }
  if (
    ['upgrade_required', 'plan_required'].includes(string(ai.status)) &&
    exposed('notion-ai-search')
  )
    return { tool: 'notion-ai-search', restrictions: object(ai.restricted_parameters) }
  throw new NativeSearchError(
    'unavailable',
    'Notion search is unavailable for this connection. Check the enabled tools and workspace plan.'
  )
}

export async function searchNotionMcp(
  client: ManagedSearchMcpClient,
  input: NativeSearchInput
): Promise<NativePage> {
  const query = nativeText(input)
  const browsing = Boolean(input.native?.browse)
  if (
    browsing &&
    (query ||
      input.native?.project ||
      input.native?.modifiers ||
      input.native?.termClauses?.length ||
      input.native?.keywordOnly)
  )
    throw new NativeSearchError(
      'unavailable',
      'Notion sidebar browsing requires an empty query without page scope or search operators.'
    )
  const { tool, restrictions } = await searchTool(client, input.native)
  const supported = (path: string) =>
    client.hasArgument?.(tool, path) === true &&
    !Object.keys(restrictions).some((key) => path === key || path.startsWith(`${key}.`))
  const localFilters = hasDateBounds(input.filters) || Boolean(dateSortDirection(input.filters))
  const args: Record<string, unknown> = browsing ? {} : { query, query_type: 'internal' }
  let providerDates = false
  if (!browsing) {
    if (input.native?.project) {
      const scope = notionResource(input.native.project)
      if (!scope || !supported('page_url'))
        throw new NativeSearchError(
          'unavailable',
          'Notion page scope requires a Notion page URL or ID and a connection advertising page_url. Search by page title if scoped search is unavailable.'
        )
      args.page_url = scope.url
    }
    const bounds = nativeDateBounds(input)
    const start =
      bounds.start && supported('filters.last_edited_date_range.start_date')
        ? bounds.start
        : undefined
    const end =
      bounds.end && supported('filters.last_edited_date_range.end_date') ? bounds.end : undefined
    if (start || end) {
      // Date-only provider bounds have no timezone; widen candidate days before exact local checks.
      const day = (value: string, offset: number) =>
        new Date(Date.parse(value) + offset * 86_400_000).toISOString().slice(0, 10)
      args.filters = {
        last_edited_date_range: {
          ...(start ? { start_date: day(start, -1) } : {}),
          ...(end ? { end_date: day(end, 2) } : {}),
        },
      }
      providerDates = true
    }
    if (input.filters?.sortBy === 'newest' && supported('sort')) args.sort = 'last_edited'
    if (!query && !providerDates && !args.sort)
      throw new NativeSearchError(
        'unavailable',
        'Notion date-only search requires supported modification filters or newest sorting on the workspace plan. Use an explicit private, shared, favorites or recent browse mode, or supply search terms.'
      )
  }
  const limit = Math.max(1, Math.min(input.limit, localFilters ? 10 : 50))
  if (client.hasArgument?.(tool, 'page_size')) args.page_size = limit
  else if (client.hasArgument?.(tool, 'limit')) args.limit = limit
  const cursorKey = client.hasArgument?.(tool, 'cursor')
    ? 'cursor'
    : client.hasArgument?.(tool, 'start_cursor')
      ? 'start_cursor'
      : undefined
  if (input.native?.cursor) {
    if (!cursorKey)
      throw new NativeSearchError(
        'unavailable',
        'Notion does not advertise a continuation for this search. Narrow the query.'
      )
    args[cursorKey] = input.native.cursor
  }
  const result = object(await client.call(tool, args))
  if (!Array.isArray(result.results))
    throw new NativeSearchError(
      'unavailable',
      'Notion search returned an unsupported result format; no complete coverage can be claimed.'
    )
  const rows = array(result.results)
  let documents: NativeDocument[] = []
  const seen = new Set<string>()
  let dropped = false
  let clipped = false
  for (const row of rows) {
    const document = searchDocument(row)
    if (!document) {
      dropped = true
      continue
    }
    if (seen.has(document.id)) continue
    seen.add(document.id)
    if (documents.length >= limit) {
      clipped = true
      continue
    }
    documents.push(document)
  }
  if (localFilters) {
    const hydrated: NativeDocument[] = []
    for (const document of documents) {
      try {
        const current = await readNotionMcp(client, document.id)
        hydrated.push({ ...document, content: current.content, modifiedAt: current.modifiedAt })
      } catch (error) {
        if (!(error instanceof NativeSearchError) || error.status === 'reconnect') throw error
        dropped = true
      }
    }
    documents = hydrated
  }
  const continuation = result.next_cursor ?? result.nextCursor
  if (
    continuation !== undefined &&
    continuation !== null &&
    (typeof continuation !== 'string' ||
      !continuation ||
      continuation.length > 2048 ||
      continuation === input.native?.cursor)
  )
    throw new NativeSearchError('unavailable', 'Notion returned an invalid search continuation.')
  const next = string(continuation)
  const nextCursor = cursorKey && next && !clipped ? next : undefined
  const notices = array(result.notices).length > 0
  const aiSearch =
    result.type === 'ai_search' ||
    (tool === 'notion-ai-search' && result.type !== 'workspace_search')
  const hasMore = clipped || result.has_more === true || result.hasMore === true || Boolean(next)
  const cappedWithoutCoverage =
    rows.length >= limit && !next && result.has_more !== false && result.hasMore !== false
  return {
    documents,
    nextCursor,
    hasMore,
    partial:
      dropped ||
      clipped ||
      notices ||
      aiSearch ||
      localFilters ||
      cappedWithoutCoverage ||
      (hasMore && !nextCursor),
    message:
      (browsing
        ? `Notion lists ${input.native?.browse} sidebar pages and databases, not an exhaustive workspace inventory. Recent means viewed/frequency, not last modified. List entries are navigation metadata; read pages for content evidence.`
        : 'Notion searches page content with the connected member’s current access. Only Notion pages and databases are returned; connected-app results are excluded. Read important matches before relying on them.') +
      (tool === 'notion-search'
        ? ' This connection uses keyword search; use short, specific title or content terms.'
        : '') +
      (aiSearch
        ? ' AI results are a ranked selection, not an exhaustive inventory. Refine short queries for additional matches.'
        : '') +
      (notices
        ? ' Notion returned plan or search notices; requested coverage may be limited.'
        : '') +
      (providerDates
        ? ' Provider modification-day filters narrow candidates; exact timestamps are checked from current page metadata.'
        : '') +
      (localFilters
        ? ' Dates and sorting use freshly fetched page modification timestamps for at most 10 candidates; this does not exhaustively search a date range or establish global oldest/newest results.'
        : '') +
      (hasMore && !nextCursor
        ? ' More results may exist, but no safe continuation is available. Narrow the query.'
        : cappedWithoutCoverage
          ? ' Notion filled the requested page without a total or continuation. Narrow the query for more complete coverage.'
          : ''),
  }
}

export async function readNotionMcp(
  client: ManagedSearchMcpClient,
  id: string
): Promise<NativeDocument> {
  const requested = notionResource(id)
  if (!requested) throw new NativeSearchError('unavailable', 'Invalid Notion resource reference.')
  const result = object(await client.call('notion-fetch', { id: requested.id }))
  const returnedId = string(result.id)
  const returnedUrl = string(result.url)
  if (
    (returnedId && pageId(returnedId) !== requested.id) ||
    (returnedUrl && notionResource(returnedUrl)?.id !== requested.id)
  )
    throw new NativeSearchError('unavailable', 'Notion returned a different resource identity.')
  const content = string(result.text ?? result.markdown ?? result.content)
  if (!content)
    throw new NativeSearchError(
      'unavailable',
      'Notion returned no readable page content. Check your current access.'
    )
  const truncated = result.truncated === true || Number(result.unknown_block_count) > 0
  return {
    id: requested.id,
    kind: 'mcp',
    title: string(result.title) || 'Notion page',
    url: returnedUrl || requested.url,
    content:
      (truncated
        ? 'Coverage: page content is incomplete because Notion omitted some subtrees. Open the source page for the full content.\n\n'
        : '') + content,
    modifiedAt: modifiedDate(result),
  }
}
