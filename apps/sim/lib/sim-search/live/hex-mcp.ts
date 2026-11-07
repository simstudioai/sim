import { isRecordLike } from '@sim/utils/object'
import { mapWithConcurrency } from '@/lib/core/utils/concurrency'
import { dateSortDirection, hasDateBounds, nativeText } from '@/lib/sim-search/live/dates'
import { NativeSearchError, object } from '@/lib/sim-search/live/http'
import type { ManagedSearchMcpClient } from '@/lib/sim-search/live/managed-mcp'
import type { NativeDocument, NativePage, NativeSearchInput } from '@/lib/sim-search/live/types'

const UUID = /^[\da-f]{8}-[\da-f]{4}-[\da-f]{4}-[\da-f]{4}-[\da-f]{12}$/i
const MAX_CANDIDATES = 10
const MAX_CELL_PAGES = 8
const MAX_CONTENT_BYTES = 512 * 1024

function invalid(message: string): never {
  throw new NativeSearchError('unavailable', message)
}

async function workspace(client: ManagedSearchMcpClient): Promise<string> {
  const result = object(await client.call('get_me', {}))
  const id = object(result.org).id
  if (typeof id !== 'string' || !UUID.test(id))
    invalid('Hex did not identify the connected workspace.')
  return id
}

async function project(
  client: ManagedSearchMcpClient,
  id: string,
  workspaceId: string
): Promise<NativeDocument | undefined> {
  const row = object(await client.call('get_project', { projectId: id }))
  if (
    row.id !== id ||
    row.type !== 'PROJECT' ||
    typeof row.title !== 'string' ||
    Buffer.byteLength(row.title, 'utf8') > 4096 ||
    (row.description !== null && typeof row.description !== 'string') ||
    row.trashedAt !== null ||
    typeof row.lastEditedAt !== 'string' ||
    !Number.isFinite(Date.parse(row.lastEditedAt))
  )
    return undefined
  const modifiedAt = new Date(row.lastEditedAt).toISOString()
  const content = `Hex project metadata, not notebook content.\n${row.description ?? ''}`
  if (Buffer.byteLength(content, 'utf8') > MAX_CONTENT_BYTES)
    invalid('Hex project metadata exceeds the 512 KiB text limit.')
  return {
    id,
    container: workspaceId,
    kind: 'project',
    title: row.title || 'Untitled Hex project',
    url: `https://app.hex.tech/${workspaceId}/hex/${id}/draft/logic`,
    modifiedAt,
    revision: modifiedAt,
    content,
  }
}

/** Searches current project metadata with at most ten candidates and no continuation. */
export async function searchHexMcp(
  client: ManagedSearchMcpClient,
  input: NativeSearchInput
): Promise<NativePage> {
  const query = nativeText(input)
  if (!query || query.length > 400 || query.includes('*'))
    invalid('Hex requires nonempty search terms of at most 400 characters, without wildcards.')
  if (
    input.native?.project ||
    input.native?.browse ||
    input.native?.cursor ||
    input.native?.modifiers ||
    input.native?.termClauses?.length ||
    input.native?.keywordOnly ||
    input.native?.kind
  )
    invalid('Hex supports plain project search terms; other selectors are unsupported.')
  const workspaceId = await workspace(client)
  const result = object(await client.call('search_projects', { query }))
  if (
    result.orgId !== workspaceId ||
    result.baseUrl !== 'https://app.hex.tech' ||
    !Array.isArray(result.projects) ||
    result.projects.length > 200
  )
    invalid('Hex returned an unsupported search response or a different workspace.')
  const ids = new Set<string>()
  let dropped = false
  for (const row of result.projects) {
    if (
      !isRecordLike(row) ||
      typeof row.projectId !== 'string' ||
      !UUID.test(row.projectId) ||
      (row.type !== 'project' && row.type !== 'app')
    ) {
      dropped = true
      continue
    }
    ids.add(row.projectId)
  }
  const limit = Math.max(1, Math.min(MAX_CANDIDATES, input.limit))
  const documents = await mapWithConcurrency([...ids].slice(0, limit), 3, async (id) => {
    try {
      const document = await project(client, id, workspaceId)
      if (!document) dropped = true
      return document
    } catch (error) {
      if (!(error instanceof NativeSearchError) || error.diagnosticCode !== 'mcp_tool_error')
        throw error
      dropped = true
      return undefined
    }
  })
  const capped = ids.size > limit
  const localDates = hasDateBounds(input.filters) || Boolean(dateSortDirection(input.filters))
  return {
    documents: documents.filter((document) => document !== undefined),
    hasMore: capped,
    partial: dropped || capped || localDates,
    message:
      'Hex searches published and unpublished projects. Previews contain project metadata, not notebook evidence. Read a result for its available draft source cells. Search is bounded and has no continuation.' +
      (localDates ? ' Dates and date sorting cover only the retrieved candidates.' : '') +
      (capped ? ' The candidate limit was reached; narrow the query.' : '') +
      (dropped ? ' Unsupported or no-longer-readable project metadata was excluded.' : ''),
  }
}

/** Hex exposes draft source cells, not the published app's rendered results or warehouse data. */
export async function readHexMcp(
  client: ManagedSearchMcpClient,
  reference: Pick<NativeDocument, 'id' | 'container' | 'kind' | 'revision'>
): Promise<NativeDocument> {
  if (
    !UUID.test(reference.id) ||
    !reference.container ||
    !UUID.test(reference.container) ||
    reference.kind !== 'project'
  )
    invalid('Invalid Hex project reference. Search again.')
  const workspaceId = await workspace(client)
  if (workspaceId !== reference.container)
    invalid('The Hex workspace changed. Search again using the connected workspace.')
  const before = await project(client, reference.id, workspaceId)
  if (!before || !reference.revision || before.revision !== reference.revision)
    invalid('The Hex project changed or is no longer readable. Search again.')
  const parts: string[] = []
  let bytes = 0
  const append = (text: string) => {
    bytes += Buffer.byteLength(text, 'utf8') + (parts.length ? 2 : 0)
    if (bytes > MAX_CONTENT_BYTES)
      invalid('Hex project exceeds the complete text limit of 512 KiB. Open it in Hex.')
    parts.push(text)
  }
  append(
    'Hex draft notebook source. This is not a published app snapshot. SQL and Python are source code, not query results. Rendered charts, outputs, attachments, and notebook section nesting are not included.'
  )
  append(before.content)
  const ids = new Set<string>()
  const staticIds = new Set<string>()
  const cursors = new Set<string>()
  let after: string | undefined
  for (let page = 0; page < MAX_CELL_PAGES; page++) {
    const result = object(
      await client.call('list_cells', {
        projectId: reference.id,
        limit: 100,
        ...(after ? { after } : {}),
      })
    )
    if (
      !Array.isArray(result.values) ||
      result.values.length > 100 ||
      !isRecordLike(result.pagination)
    )
      invalid('Hex returned an unsupported notebook cell page.')
    for (const row of result.values) {
      if (
        !isRecordLike(row) ||
        row.projectId !== reference.id ||
        typeof row.id !== 'string' ||
        !row.id ||
        row.id.length > 200 ||
        ids.has(row.id) ||
        typeof row.staticId !== 'string' ||
        !row.staticId ||
        row.staticId.length > 200 ||
        staticIds.has(row.staticId) ||
        typeof row.cellType !== 'string' ||
        !/^[A-Z_]{1,64}$/.test(row.cellType) ||
        (row.label !== null && typeof row.label !== 'string') ||
        !isRecordLike(row.contents)
      )
        invalid('Hex returned mismatched or incomplete notebook cells.')
      ids.add(row.id)
      staticIds.add(row.staticId)
      let source: string | undefined
      for (const [type, key] of [
        ['CODE', 'codeCell'],
        ['SQL', 'sqlCell'],
        ['MARKDOWN', 'markdownCell'],
      ] as const) {
        const value = row.contents[key]
        if (row.cellType === type) {
          if (!isRecordLike(value) || typeof value.source !== 'string')
            invalid('Hex returned an incomplete source cell.')
          source = value.source
        } else if (value !== null) invalid('Hex returned an unsupported source cell.')
      }
      append(
        `Cell ${row.staticId} (${row.cellType})${row.label ? `: ${row.label}` : ''}\n${source ?? 'Source and rendered output are not available for this cell type.'}`
      )
    }
    const next = result.pagination.after
    if (next === undefined || next === null || next === '') {
      const current = await project(client, reference.id, workspaceId)
      if (!current || current.revision !== before.revision)
        invalid('The Hex project changed while it was being read. Search again.')
      if ((await workspace(client)) !== workspaceId)
        invalid('The Hex workspace changed while it was being read. Search again.')
      return { ...current, content: parts.join('\n\n') }
    }
    if (
      typeof next !== 'string' ||
      next.length > 2048 ||
      !result.values.length ||
      cursors.has(next)
    )
      invalid('Hex returned an invalid notebook pagination cursor.')
    cursors.add(next)
    after = next
  }
  return invalid('Hex notebook exceeds the complete-read page limit. Open it in Hex.')
}
