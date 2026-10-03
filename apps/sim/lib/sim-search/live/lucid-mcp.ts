import { isRecordLike } from '@sim/utils/object'
import { truncate } from '@sim/utils/string'
import { mapWithConcurrency } from '@/lib/core/utils/concurrency'
import {
  dateSortDirection,
  hasDateBounds,
  nativeDateBounds,
  nativeText,
} from '@/lib/sim-search/live/dates'
import { NativeSearchError, object, string } from '@/lib/sim-search/live/http'
import type { ManagedSearchMcpClient } from '@/lib/sim-search/live/managed-mcp'
import type { NativeDocument, NativePage, NativeSearchInput } from '@/lib/sim-search/live/types'

const UUID = /^[\da-f]{8}-[\da-f]{4}-[\da-f]{4}-[\da-f]{4}-[\da-f]{12}$/i
const PRODUCTS = ['lucidchart', 'lucidspark'] as const
const MAX_CANDIDATES = 10
const MAX_REGIONS = 8
const MAX_CONTENT_BYTES = 512 * 1024

function invalid(message: string): never {
  throw new NativeSearchError('unavailable', message)
}

function resource(value: string): { id: string; kind?: string } | undefined {
  if (UUID.test(value)) return { id: value.toLowerCase() }
  try {
    const url = new URL(value)
    const parts = url.pathname.split('/').filter(Boolean)
    if (
      url.origin !== 'https://lucid.app' ||
      url.username ||
      url.password ||
      parts.length !== 3 ||
      !PRODUCTS.some((product) => product === parts[0]) ||
      !UUID.test(parts[1] ?? '') ||
      !['edit', 'view'].includes(parts[2] ?? '')
    )
      return undefined
    return { id: parts[1]!.toLowerCase(), kind: parts[0] }
  } catch {
    return undefined
  }
}

async function metadata(
  client: ManagedSearchMcpClient,
  id: string
): Promise<NativeDocument | undefined> {
  if (!UUID.test(id)) invalid('Invalid Lucid document identity.')
  const row = object(await client.call('lucid_get_document_metadata', { document_id: id }))
  const url = resource(string(row.viewUrl))
  if (
    row.documentId !== id ||
    url?.id !== id ||
    url.kind !== row.product ||
    typeof row.title !== 'string' ||
    row.trashed ||
    !Number.isSafeInteger(row.version) ||
    Number(row.version) < 0 ||
    !Number.isSafeInteger(row.pageCount) ||
    Number(row.pageCount) < 1 ||
    typeof row.lastModified !== 'string' ||
    !Number.isFinite(Date.parse(row.lastModified))
  )
    return undefined
  return {
    id,
    kind: url.kind,
    title: row.title,
    url: `https://lucid.app/${url.kind}/${id}/view`,
    revision: String(row.version),
    modifiedAt: row.lastModified,
    accessMetadata: { pageCount: row.pageCount },
    content:
      'Lucid document match. Read this document for its structured diagram or board content.',
  }
}

export async function searchLucidMcp(
  client: ManagedSearchMcpClient,
  input: NativeSearchInput
): Promise<NativePage> {
  const query = nativeText(input)
  if (input.native?.browse) return browseFolder(client, input)
  if (!query.trim()) invalid('Lucid requires search terms, including for date-filtered searches.')
  const project = input.native?.project
  if ([...query].length > (project ? 200 : 400))
    invalid(`Lucid search terms must be at most ${project ? 200 : 400} characters.`)
  if (
    input.native?.cursor ||
    input.native?.modifiers ||
    input.native?.termClauses?.length ||
    input.native?.keywordOnly
  )
    invalid('Lucid accepts plain terms; query operators and search continuations are unsupported.')
  const products = PRODUCTS.filter(
    (product) => !input.native?.kind || input.native.kind === product
  )
  if (!products.length) invalid('Lucid supports lucidchart and lucidspark document kinds.')
  if (project) {
    const scope = resource(project)
    if (!scope || !query.trim())
      invalid(
        'Lucid document search requires a document UUID or Lucid URL and a literal text query.'
      )
    const document = await metadata(client, scope.id)
    if (!document) invalid('Lucid document metadata is incomplete or no longer readable.')
    if (
      (scope.kind && document.kind !== scope.kind) ||
      !products.some((product) => product === document.kind)
    )
      invalid('The Lucid document does not match the requested product.')
    const result = object(
      await client.call('lucid_search_document', { id: document.id, queries: [query] })
    )
    const matchedResource = resource(string(result.edit_url))
    if (
      result.document_id !== document.id ||
      matchedResource?.id !== document.id ||
      matchedResource.kind !== document.kind
    )
      invalid('Lucid document-search identity does not match the requested document.')
    const matches = object(result.matches)[query]
    if (
      !Array.isArray(matches) ||
      matches.some(
        (match) =>
          !isRecordLike(match) ||
          !Number.isSafeInteger(match.pageIndex) ||
          Number(match.pageIndex) < 1 ||
          Number(match.pageIndex) > Number(document.accessMetadata?.pageCount) ||
          !Number.isSafeInteger(match.regionIndex) ||
          Number(match.regionIndex) < 1 ||
          !Array.isArray(match.context) ||
          match.context.some((text) => typeof text !== 'string')
      )
    )
      invalid('Lucid returned an unsupported document-search result.')
    const preview = matches
      .map(
        (match) =>
          `Page ${match.pageIndex}, region ${match.regionIndex}: ${match.context.join('\n')}`
      )
      .join('\n')
    if (Buffer.byteLength(preview, 'utf8') > MAX_CONTENT_BYTES)
      invalid('Lucid matches exceed the search size limit. Narrow the query.')
    return {
      documents: matches.length ? [{ ...document, content: preview }] : [],
      message:
        'Lucid matched literal, case-insensitive substrings in shape labels within the specified document. Notes, tags, links and comments are not searched. Read the document for surrounding structure.',
    }
  }
  const bounds = nativeDateBounds(input)
  const result = object(
    await client.call('search', {
      query,
      product: products,
      ...(bounds.start
        ? { last_modified_after: new Date(Date.parse(bounds.start) - 1000).toISOString() }
        : {}),
    })
  )
  if (!Array.isArray(result.results)) invalid('Lucid search returned an unsupported result format.')
  const candidates: { id: string; kind: string }[] = []
  let dropped = false
  const seen = new Set<string>()
  for (const row of result.results) {
    const reference = isRecordLike(row) ? resource(string(row.url)) : undefined
    if (
      !reference?.kind ||
      !isRecordLike(row) ||
      reference.id !== row.id ||
      !products.some((product) => product === reference.kind)
    ) {
      dropped = true
      continue
    }
    if (seen.has(reference.id)) continue
    seen.add(reference.id)
    candidates.push({ id: reference.id, kind: reference.kind })
  }
  const limit = Math.max(1, Math.min(MAX_CANDIDATES, input.limit))
  const documents = await mapWithConcurrency(candidates.slice(0, limit), 3, async (candidate) => {
    const document = await metadata(client, candidate.id)
    if (!document || document.kind !== candidate.kind) {
      dropped = true
      return undefined
    }
    return document
  })
  const capped = candidates.length > limit || result.results.length >= 200
  const localDates = hasDateBounds(input.filters) || Boolean(dateSortDirection(input.filters))
  return {
    documents: documents.filter((document) => document !== undefined),
    hasMore: capped,
    partial: dropped || capped || localDates,
    message:
      'Lucid finds documents by title keywords, with up to 200 relevance-ranked candidates from the provider and at most 10 current metadata reads. Previews are metadata, not diagram evidence. For shape text, find a document, then set project to its UUID or Lucid URL. No search continuation is available.' +
      (localDates
        ? ' Dates use current modification timestamps; sorting and the end-date filter cover only the retrieved candidates, not the entire account.'
        : '') +
      (capped ? ' The candidate limit was reached; narrow the title query.' : '') +
      (dropped ? ' Unsupported or no-longer-readable search results were excluded.' : ''),
  }
}

/** A single folder page stays within the metadata budget and never recursively expands folders. */
async function browseFolder(
  client: ManagedSearchMcpClient,
  input: NativeSearchInput
): Promise<NativePage> {
  const native = input.native
  if (
    native?.browse !== 'folder' ||
    nativeText(input) ||
    native.modifiers ||
    native.termClauses?.length ||
    native.keywordOnly
  )
    invalid('Lucid folder browsing requires an empty query without search operators.')
  if (native.project && !/^[1-9]\d{0,14}$/.test(native.project))
    invalid('Lucid folder browsing requires a numeric folder ID.')
  if (client.hasTool?.('lucid_list_folder_contents') !== true)
    invalid('Lucid folder browsing is unavailable on this connection.')
  if (native.kind && !PRODUCTS.some((product) => product === native.kind))
    invalid('Lucid supports lucidchart and lucidspark document kinds.')
  const limit = Math.max(1, Math.min(MAX_CANDIDATES, input.limit))
  const result = object(
    await client.call('lucid_list_folder_contents', {
      page_size: limit,
      ...(native.project ? { folder_id: Number(native.project) } : {}),
      ...(native.cursor ? { page_token: native.cursor } : {}),
    })
  )
  if (!Array.isArray(result.items) || result.items.length > limit)
    invalid('Lucid returned an invalid or oversized folder page; restart with a smaller page.')
  if (
    result.nextPageToken !== undefined &&
    (typeof result.nextPageToken !== 'string' ||
      !result.nextPageToken ||
      result.nextPageToken.length > 2048 ||
      result.nextPageToken === native.cursor)
  )
    invalid('Lucid returned an invalid folder continuation.')
  const folders: NonNullable<NativePage['folders']> = []
  const candidates: { id: string; kind: string }[] = []
  const seen = new Set<string>()
  let dropped = false
  for (const item of result.items) {
    const row = object(item)
    if (row.isShortcut !== false) {
      dropped = true
      continue
    }
    if (row.type === 'folder') {
      const id =
        typeof row.id === 'number' && Number.isSafeInteger(row.id) ? String(row.id) : string(row.id)
      if (!/^[1-9]\d{0,14}$/.test(id) || typeof row.name !== 'string') {
        dropped = true
        continue
      }
      if (!seen.has(`folder:${id}`)) folders.push({ id, name: truncate(row.name, 200) })
      seen.add(`folder:${id}`)
      continue
    }
    const id = string(row.id)
    const kind = string(row.product)
    if (
      row.type !== 'document' ||
      !UUID.test(id) ||
      !PRODUCTS.some((product) => product === kind)
    ) {
      dropped = true
      continue
    }
    if (native.kind && native.kind !== kind) continue
    if (!seen.has(id)) candidates.push({ id, kind })
    seen.add(id)
  }
  const documents = await mapWithConcurrency(candidates, 3, async (candidate) => {
    const document = await metadata(client, candidate.id)
    if (!document || document.kind !== candidate.kind) {
      dropped = true
      return undefined
    }
    return document
  })
  const nextCursor = string(result.nextPageToken) || undefined
  return {
    documents: documents.filter((document) => document !== undefined),
    folders,
    nextCursor,
    hasMore: Boolean(nextCursor),
    partial: dropped || hasDateBounds(input.filters) || Boolean(dateSortDirection(input.filters)),
    message:
      'Lucid lists one folder’s direct children, not the entire account. Child folders are navigation references: use browse folder with their ID as project. Continue the same folder with nextCursor, including when no documents matched this page. Dates and sorting apply only to this page’s current document metadata; folder names and document titles are not diagram evidence.' +
      (dropped ? ' Shortcuts, unsupported items or unreadable metadata were excluded.' : ''),
  }
}

function manifest(value: unknown, id: string, kind: string | undefined) {
  const row = object(value)
  const url = resource(string(row.edit_url))
  const details = object(row.metadata)
  const counts = details.page_region_counts
  if (
    row.document_id !== id ||
    url?.id !== id ||
    url.kind !== kind ||
    typeof row.title !== 'string' ||
    !Number.isSafeInteger(details.page_count) ||
    Number(details.page_count) < 1 ||
    !Array.isArray(counts) ||
    counts.length !== details.page_count ||
    counts.some((count) => !Number.isSafeInteger(count) || count < 0)
  )
    invalid('Lucid returned incomplete document coverage or mismatched identity.')
  if (counts.reduce((total: number, count: number) => total + Math.max(1, count), 0) > MAX_REGIONS)
    invalid(
      'Lucid document exceeds the complete-read limit of 8 page regions. Open the source document or narrow it into smaller documents.'
    )
  return { row, counts: counts as number[] }
}

/** Complete, bounded provider pages preserve graph data; no returned URL is fetched. */
export async function readLucidMcp(
  client: ManagedSearchMcpClient,
  reference: Pick<NativeDocument, 'id' | 'kind' | 'revision'>
): Promise<NativeDocument> {
  const before = await metadata(client, reference.id)
  if (!before) invalid('Lucid document metadata is incomplete or no longer readable.')
  if (
    (reference.kind && reference.kind !== before.kind) ||
    (reference.revision && reference.revision !== before.revision)
  )
    invalid('Lucid document changed since this result was issued. Search again before reading.')
  const initial = manifest(
    await client.call('fetch', { id: before.id, metadata_only: true }),
    before.id,
    before.kind
  )
  if (
    initial.counts.length !== before.accessMetadata?.pageCount ||
    initial.row.title !== before.title
  )
    invalid('Lucid document coverage changed before reading. Search again.')
  const pages: Record<string, unknown>[] = []
  const output = () => JSON.stringify({ document_id: before.id, title: before.title, pages })
  for (let pageIndex = 0; pageIndex < initial.counts.length; pageIndex++) {
    const count = initial.counts[pageIndex]!
    let assembled: Record<string, unknown> | undefined
    const chunks: Record<string, unknown>[] = []
    for (let region = 0; region < Math.max(1, count); region++) {
      const fetched = manifest(
        await client.call('fetch', {
          id: before.id,
          page_index: pageIndex + 1,
          ...(count ? { region_index: [region + 1] } : {}),
        }),
        before.id,
        before.kind
      )
      if (
        fetched.counts.some((value, index) => value !== initial.counts[index]) ||
        fetched.counts.length !== initial.counts.length ||
        object(fetched.row.metadata).page_index !== pageIndex + 1 ||
        fetched.row.page_index !== pageIndex + 1 ||
        typeof fetched.row.text !== 'string'
      )
        invalid('Lucid document coverage changed during reading. Search again.')
      let parsed: unknown
      try {
        parsed = JSON.parse(fetched.row.text)
      } catch {
        invalid('Lucid returned malformed diagram content.')
      }
      const returnedPages = object(parsed).pages
      if (!Array.isArray(returnedPages) || returnedPages.length !== 1)
        invalid('Lucid returned incomplete page content.')
      const page = object(returnedPages[0])
      const returnedChunks = page.requestedChunks
      if (
        page.pageIndex !== pageIndex ||
        typeof page.pageId !== 'string' ||
        !page.pageId ||
        page.pageId !== fetched.row.page_id ||
        typeof page.pageTitle !== 'string' ||
        page.totalChunks !== count ||
        !Array.isArray(returnedChunks) ||
        returnedChunks.length !== (count ? 1 : 0) ||
        returnedChunks.some(
          (chunk) =>
            !isRecordLike(chunk) || chunk.chunkIndex !== region || !isRecordLike(chunk.data)
        ) ||
        (assembled && (assembled.pageId !== page.pageId || assembled.pageTitle !== page.pageTitle))
      )
        invalid('Lucid returned missing, duplicate, or mismatched page regions.')
      if (!assembled) {
        if (pages.some((existing) => existing.pageId === page.pageId))
          invalid('Lucid returned duplicate page identities.')
        assembled = { ...page, requestedChunks: chunks }
        pages.push(assembled)
      }
      chunks.push(...returnedChunks)
      if (Buffer.byteLength(output(), 'utf8') > MAX_CONTENT_BYTES)
        invalid('Lucid document exceeds the 512 KiB complete-read limit. Open the source document.')
    }
  }
  const after = await metadata(client, before.id)
  if (
    !after ||
    after.revision !== before.revision ||
    after.kind !== before.kind ||
    after.modifiedAt !== before.modifiedAt ||
    after.title !== before.title ||
    after.accessMetadata?.pageCount !== before.accessMetadata?.pageCount
  )
    invalid('Lucid document changed while being read. Search again before reading.')
  return { ...before, content: output() }
}
