import { dateSortDirection, hasDateBounds, nativeText } from '@/lib/sim-search/live/dates'
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

/** Tool visibility and workspace-plan access are separate; the current access map owns routing. */
async function searchTool(client: ManagedSearchMcpClient): Promise<string> {
  const access = object(object(await client.call('notion-get-tool-access', {})).current_tool_access)
  const ai = string(object(access.ai_search).status)
  const keyword = string(object(access.search).status)
  const exposed = (name: string) => client.hasTool?.(name) !== false
  if (ai === 'available' && exposed('notion-ai-search')) return 'notion-ai-search'
  if (['available', 'available_with_limit'].includes(keyword) && exposed('notion-search'))
    return 'notion-search'
  if (['upgrade_required', 'plan_required'].includes(ai) && exposed('notion-ai-search'))
    return 'notion-ai-search'
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
  if (!query)
    throw new NativeSearchError(
      'unavailable',
      'Notion requires search terms. Use short keywords or a concise question, then narrow by dates.'
    )
  const tool = await searchTool(client)
  const localFilters = hasDateBounds(input.filters) || Boolean(dateSortDirection(input.filters))
  const args: Record<string, unknown> = { query, query_type: 'internal' }
  if (input.native?.project) {
    const scope = notionResource(input.native.project)
    if (!scope || !client.hasArgument?.(tool, 'page_url'))
      throw new NativeSearchError(
        'unavailable',
        'Notion page scope requires a Notion page URL or ID and a connection advertising page_url. Search by page title if scoped search is unavailable.'
      )
    args.page_url = scope.url
  }
  const limit = Math.min(input.limit, localFilters ? 10 : 50)
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
  const next = string(result.next_cursor ?? result.nextCursor)
  const nextCursor = cursorKey && next && !clipped ? next : undefined
  const notices = array(result.notices).length > 0
  const aiSearch = result.type === 'ai_search'
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
      'Notion searches page content with the connected member’s current access. Only Notion pages and databases are returned; connected-app results are excluded. Read important matches before relying on them.' +
      (tool === 'notion-search'
        ? ' This connection uses keyword search; use short, specific title or content terms.'
        : '') +
      (aiSearch
        ? ' AI results are a ranked selection, not an exhaustive inventory. Refine short queries for additional matches.'
        : '') +
      (notices
        ? ' Notion returned plan or search notices; requested coverage may be limited.'
        : '') +
      (localFilters
        ? ' Dates and sorting use freshly fetched page modification timestamps for at most 10 candidates; this does not exhaustively search a date range.'
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
