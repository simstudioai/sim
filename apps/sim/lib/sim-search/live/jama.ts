import { isRecordLike } from '@sim/utils/object'
import { truncate } from '@sim/utils/string'
import { nativeText } from '@/lib/sim-search/live/dates'
import { array, NativeSearchError, object, string } from '@/lib/sim-search/live/http'
import type {
  NativeClient,
  NativeDocument,
  NativePage,
  NativeSearchInput,
} from '@/lib/sim-search/live/types'
import { htmlToPlainText } from '@/connectors/utils'

const NUMERIC_ID = /^[1-9]\d*$/
const MAX_ITEM_TEXT = 120_000

function itemDocument(row: Record<string, unknown>, origin: string): NativeDocument | undefined {
  const id = string(row.id)
  const project = string(row.project)
  if (!NUMERIC_ID.test(id) || !NUMERIC_ID.test(project) || !isRecordLike(row.fields))
    return undefined
  const fields = object(row.fields)
  const entries = Object.entries(fields)
  const content = entries
    .slice(0, 100)
    .flatMap(([name, value]) => {
      const text =
        typeof value === 'string'
          ? htmlToPlainText(value)
          : typeof value === 'number' || typeof value === 'boolean'
            ? String(value)
            : ''
      return text ? [`${name}: ${text}`] : []
    })
    .join('\n\n')
  return {
    id,
    container: project,
    kind: 'item',
    title:
      [string(row.documentKey), string(fields.name)].filter(Boolean).join(' · ') || `Item ${id}`,
    url: `${origin}/rest/v1/abstractitems/${id}`,
    content: truncate(
      content + (entries.length > 100 ? '\n[Item fields truncated]' : ''),
      MAX_ITEM_TEXT,
      '\n[Item text truncated]'
    ),
    modifiedAt: string(row.modifiedDate) || undefined,
  }
}

/** Retrieves one bounded page using the connected person's current Jama permissions. */
export async function searchJama(
  client: NativeClient,
  input: NativeSearchInput,
  origin?: string
): Promise<NativePage> {
  if (!origin)
    throw new NativeSearchError('reconnect', 'Reconnect Jama Connect to restore its instance URL.')
  const query = nativeText(input)
  if (!query || query.length > 1024)
    throw new NativeSearchError(
      'unavailable',
      'Enter Jama search text between 1 and 1024 characters.'
    )
  const project = input.native?.project
  if (project && !NUMERIC_ID.test(project))
    throw new NativeSearchError('unavailable', 'Jama project scope requires a numeric project ID.')
  const cursor = input.native?.cursor ?? '0'
  if (!/^\d{1,9}$/.test(cursor))
    throw new NativeSearchError('unavailable', 'Invalid Jama search cursor.')
  const start = Number(cursor)
  const limit = Math.min(input.limit, 50)
  const response = object(
    await client.json('/rest/v1/abstractitems', {
      query: {
        contains: query,
        startAt: String(start),
        maxResults: String(limit),
        ...(project ? { project } : {}),
      },
    })
  )
  const page = object(object(response.meta).pageInfo)
  if (
    !Array.isArray(response.data) ||
    page.startIndex !== start ||
    typeof page.resultCount !== 'number' ||
    !Number.isInteger(page.resultCount) ||
    page.resultCount < 0 ||
    typeof page.totalResults !== 'number' ||
    !Number.isInteger(page.totalResults) ||
    page.totalResults < 0
  ) {
    throw new NativeSearchError('unavailable', 'Jama returned an unsupported search response.')
  }
  const rows = array(response.data)
  const documents = rows.slice(0, limit).flatMap((row) => {
    const document = itemDocument(row, origin)
    return document && (!project || document.container === project) ? [document] : []
  })
  const next = start + page.resultCount
  const hasMore = next < page.totalResults
  const completePage = rows.length <= limit && page.resultCount === rows.length
  return {
    documents,
    hasMore,
    nextCursor: hasMore && completePage && next > start ? String(next) : undefined,
    partial: !completePage || documents.length !== rows.length || (hasMore && next <= start),
    message:
      'Jama searches accessible item fields. Dates and sorting apply to the returned page. Citations link to the item API resource; attachments and discussions are not included.',
  }
}

/** A read goes back to Jama rather than trusting content from an earlier search. */
export async function readJama(
  client: NativeClient,
  reference: Pick<NativeDocument, 'id' | 'container'>,
  origin?: string
): Promise<NativeDocument> {
  if (!origin || !NUMERIC_ID.test(reference.id))
    throw new NativeSearchError('unavailable', 'Invalid Jama item reference.')
  const response = object(await client.json(`/rest/v1/abstractitems/${reference.id}`))
  const document = itemDocument(object(response.data), origin)
  if (
    !document ||
    document.id !== reference.id ||
    (reference.container && document.container !== reference.container)
  ) {
    throw new NativeSearchError(
      'unavailable',
      'This Jama item is no longer available in the referenced project.'
    )
  }
  return document
}
