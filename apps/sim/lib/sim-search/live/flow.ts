import { isRecordLike } from '@sim/utils/object'
import { truncate } from '@sim/utils/string'
import { nativeText } from '@/lib/sim-search/live/dates'
import { array, NativeSearchError, object, string } from '@/lib/sim-search/live/http'
import { collectNativePages } from '@/lib/sim-search/live/pages'
import type {
  NativeClient,
  NativeDocument,
  NativePage,
  NativeSearchInput,
} from '@/lib/sim-search/live/types'
import { htmlToPlainText } from '@/connectors/utils'
import { safeUrlPathSegment } from '@/tools/url-path'

const MAX_PROJECTS = 6
const MAX_ITEM_TEXT = 120_000

function itemDocument(
  row: Record<string, unknown>,
  origin: string,
  project: string,
  humanId?: string
): NativeDocument | undefined {
  const id = string(row.id)
  if (!id || row.deleted === true || !isRecordLike(row.values)) return undefined
  const values = object(row.values)
  const valueEntries = Object.entries(values)
  const fields = valueEntries.slice(0, 100).flatMap(([key, value]) => {
    const text =
      typeof value === 'string'
        ? htmlToPlainText(value)
        : typeof value === 'number' || typeof value === 'boolean'
          ? String(value)
          : ''
    return text ? [`${key}: ${text}`] : []
  })
  const formulaEntries = Object.entries(object(row.formulas))
  const formulas = formulaEntries
    .slice(0, 100)
    .flatMap(([key, value]) => (typeof value === 'string' ? [`${key} formula: ${value}`] : []))
  return {
    id,
    container: project,
    kind: string(row.type) || 'item',
    title: [humanId, string(values.name) || `Item ${id}`].filter(Boolean).join(' · '),
    url: new URL(
      `/project/${safeUrlPathSegment(project, 'projectId')}/entities/${safeUrlPathSegment(id, 'entityId')}`,
      origin
    ).toString(),
    content: truncate(
      [
        ...fields,
        ...formulas,
        ...(valueEntries.length > 100 || formulaEntries.length > 100
          ? ['[Item fields truncated]']
          : []),
      ].join('\n\n'),
      MAX_ITEM_TEXT,
      '\n[Item text truncated]'
    ),
    modifiedAt: string(row.updatedAt) || undefined,
  }
}

async function searchProject(
  client: NativeClient,
  input: NativeSearchInput,
  origin: string,
  project: string
): Promise<NativePage> {
  const limit = Math.min(input.limit, 100)
  const projectPath = safeUrlPathSegment(project, 'projectId')
  const response = await client.json(`/project/${projectPath}/entities/search`, {
    query: {
      query: nativeText(input),
      branch_id: 'master',
      limit: String(limit),
    },
  })
  if (!Array.isArray(response))
    throw new NativeSearchError('unavailable', 'Flow returned an unsupported search response.')
  const hits = array(response).slice(0, limit)
  const ids = [...new Set(hits.map((row) => string(row.entity_id)).filter(Boolean))]
  if (!ids.length) return { documents: [], partial: response.length > 0 }
  const details = await client.json(
    `/project/${projectPath}/entities/${ids.map((id) => safeUrlPathSegment(id, 'entityId')).join(',')}`,
    { query: { branch_id: 'master', include_metadata: 'true' } }
  )
  if (!Array.isArray(details))
    throw new NativeSearchError('unavailable', 'Flow returned an unsupported item response.')
  const byId = new Map(array(details).map((row) => [string(row.id), row]))
  const documents = hits.flatMap((hit) => {
    const row = byId.get(string(hit.entity_id))
    const document = row && itemDocument(row, origin, project, string(hit.human_id))
    return document ? [document] : []
  })
  return {
    documents,
    hasMore: response.length >= limit,
    partial: response.length >= limit || documents.length !== hits.length,
  }
}

/** Searches a bounded set of projects, then reads every match with the same member credential. */
export async function searchFlow(
  client: NativeClient,
  input: NativeSearchInput,
  origin?: string
): Promise<NativePage> {
  if (!origin) throw new NativeSearchError('reconnect', 'Reconnect Flow to restore its API URL.')
  const query = nativeText(input)
  if (!query || query.length > 1024)
    throw new NativeSearchError(
      'unavailable',
      'Enter Flow search text between 1 and 1024 characters.'
    )
  if (input.native?.cursor)
    throw new NativeSearchError(
      'unavailable',
      'Flow search does not provide pagination. Narrow the query or project.'
    )
  let projects: string[]
  if (input.native?.project) projects = [input.native.project]
  else {
    const response = await client.json('/project', { query: { limit: String(MAX_PROJECTS + 1) } })
    if (!Array.isArray(response))
      throw new NativeSearchError('unavailable', 'Flow returned an unsupported project response.')
    projects = array(response)
      .map((row) => string(row.id))
      .filter(Boolean)
  }
  const result = await collectNativePages(
    projects.slice(0, MAX_PROJECTS).map((project) => searchProject(client, input, origin, project)),
    'Flow searches at most six accessible projects and 100 matches per project. Search has no continuation; narrow the query or project for more results. Citations link to API resources. Reads include current field values and formulas, not discussions or files.'
  )
  return { ...result, partial: result.partial || projects.length > MAX_PROJECTS }
}

/** Fetches current entity access; deleted or omitted entities are never returned. */
export async function readFlow(
  client: NativeClient,
  reference: Pick<NativeDocument, 'id' | 'container'>,
  origin?: string
): Promise<NativeDocument> {
  if (!origin || !reference.id || reference.id.length > 256 || !reference.container)
    throw new NativeSearchError('unavailable', 'Invalid Flow item reference.')
  const response = await client.json(
    `/project/${safeUrlPathSegment(reference.container, 'projectId')}/entities/${safeUrlPathSegment(reference.id, 'entityId')}`,
    { query: { branch_id: 'master', include_metadata: 'true' } }
  )
  if (!Array.isArray(response))
    throw new NativeSearchError('unavailable', 'Flow returned an unsupported item response.')
  const row = array(response).find((item) => string(item.id) === reference.id)
  const document = row && itemDocument(row, origin, reference.container)
  if (!document)
    throw new NativeSearchError('unavailable', 'This Flow item is no longer available.')
  return document
}
