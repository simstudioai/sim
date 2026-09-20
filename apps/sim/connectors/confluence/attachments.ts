import { z } from 'zod'
import { isPayloadSizeLimitError, readResponseJsonWithLimit } from '@/lib/core/utils/stream-limits'
import { fetchWithRetry, secureFetchWithRetry } from '@/lib/knowledge/documents/secure-fetch.server'
import {
  createRetryableHttpError,
  readBoundedHttpErrorPayload,
} from '@/lib/knowledge/documents/utils'
import { extractCursor } from '@/connectors/confluence/cursor'
import { listingFailuresSchema, MAX_LISTING_FAILURE_SAMPLES } from '@/connectors/listing-failures'
import { isAllSourceItems } from '@/connectors/selection'
import type { ExternalDocument, ExternalDocumentList } from '@/connectors/types'
import {
  CONNECTOR_MAX_FILE_BYTES,
  connectorFileExtension,
  markSkipped,
  parseMultiValue,
  pipelineParsedMimeType,
  readBodyWithLimit,
  sizeLimitSkipReason,
  stubOrSkipBySize,
} from '@/connectors/utils'

const ATTACHMENT_PREFIX = 'attachment:'
const CURSOR_PREFIX = 'attachments:'
const PAGE_SIZE = 50
const REQUESTS_PER_CALL = 5
const MAX_CURSOR_BYTES = 512 * 1024
const MAX_METADATA_BYTES = 2 * 1024 * 1024
/**
 * Attachment formats listed for indexing: a deliberate subset of the shared
 * `PIPELINE_PARSED_MIME_TYPES`, limited to the headline PDF, Word, Excel and
 * PowerPoint extensions. Macro-enabled, template, legacy binary (`.xls`, `.ppt`)
 * and OpenDocument variants are not listed for Confluence.
 */
const FILE_EXTENSIONS = new Set(['pdf', 'doc', 'docx', 'pptx', 'xlsx'])
const boundedId = z.string().min(1).max(254)
const providerCursor = z.string().min(1).max(8192)
const parentSchema = z.object({ id: boundedId, type: z.enum(['page', 'blogpost']) })
const cursorSchema = z.object({
  parentCursor: z
    .string()
    .min(1)
    .max(32 * 1024)
    .optional(),
  parents: z.array(parentSchema).max(500),
  attachmentCursor: providerCursor.optional(),
  parentsListed: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
  parentsDone: z.boolean(),
  failures: listingFailuresSchema.optional(),
})
const attachmentSchema = z.object({
  id: boundedId,
  title: z.string().min(1).max(4096),
  status: z.string(),
  pageId: boundedId.optional(),
  blogPostId: boundedId.optional(),
  customContentId: boundedId.optional(),
  fileSize: z.number().int().nonnegative().optional(),
  version: z.object({ number: z.number().int().positive(), createdAt: z.string().optional() }),
  webuiLink: z.string().optional(),
  _links: z.object({ webui: z.string().optional() }).optional(),
})
const attachmentPageSchema = z.object({
  results: z.array(attachmentSchema).max(250),
  _links: z.object({ next: providerCursor.optional() }).optional(),
})
const scopeMismatchSchema = z.object({
  code: z.literal(401),
  message: z.literal('Unauthorized; scope does not match'),
})

type Attachment = z.infer<typeof attachmentSchema>
type AttachmentCursor = z.infer<typeof cursorSchema>
type AttachmentParent = z.infer<typeof parentSchema>

interface AttachmentRequest {
  accessToken: string
  cloudId: string
  domain: string
  syncContext?: Record<string, unknown>
}

class ConfluenceAttachmentScopeError extends Error {
  constructor() {
    super('Confluence attachments require the read:attachment:confluence credential scope.')
    this.name = 'ConfluenceAttachmentScopeError'
  }
}

/** Atlassian reports missing endpoint scopes as 401 without invalidating the token itself. */
async function unauthorizedAttachmentError(response: Response): Promise<Error> {
  const payload = await readBoundedHttpErrorPayload(response)
  if (payload.ok) {
    try {
      if (scopeMismatchSchema.safeParse(JSON.parse(payload.body)).success) {
        return new ConfluenceAttachmentScopeError()
      }
    } catch {
      /** An unrecognized response remains an authentication failure. */
    }
  }
  return createRetryableHttpError({ status: response.status, headers: response.headers })
}

function signalFor(input: AttachmentRequest): AbortSignal | undefined {
  const signal = input.syncContext?.signal
  return signal instanceof AbortSignal ? signal : undefined
}

function apiBase(cloudId: string): string {
  return `https://api.atlassian.com/ex/confluence/${encodeURIComponent(cloudId)}/wiki`
}

async function requestMetadata(input: AttachmentRequest, path: string): Promise<Response> {
  return fetchWithRetry(`${apiBase(input.cloudId)}${path}`, {
    headers: { Authorization: `Bearer ${input.accessToken}`, Accept: 'application/json' },
    signal: signalFor(input),
    redirect: 'error',
  })
}

async function readMetadata(response: Response): Promise<unknown> {
  if (!response.ok) {
    if (response.status === 401) throw await unauthorizedAttachmentError(response)
    await response.body?.cancel()
    throw new Error(
      response.status === 403
        ? 'Confluence attachment access was denied. Check the parent content permissions and the read:attachment:confluence credential scope.'
        : `Failed to read Confluence attachment metadata: ${response.status}`
    )
  }
  return readResponseJsonWithLimit(response, {
    maxBytes: MAX_METADATA_BYTES,
    label: 'Confluence attachment metadata',
  })
}

function attachmentParent(attachment: Attachment): AttachmentParent {
  if (attachment.customContentId || Boolean(attachment.pageId) === Boolean(attachment.blogPostId)) {
    throw new Error('Confluence attachment has no unambiguous page or blog post parent')
  }
  return attachment.pageId
    ? { id: attachment.pageId, type: 'page' }
    : { id: attachment.blogPostId!, type: 'blogpost' }
}

function sameParent(left: AttachmentParent, right: AttachmentParent): boolean {
  return left.id === right.id && left.type === right.type
}

function attachmentMimeType(attachment: Attachment): string | undefined {
  const extension = connectorFileExtension(attachment.title)
  return extension && FILE_EXTENSIONS.has(extension)
    ? pipelineParsedMimeType(attachment.title)
    : undefined
}

function attachmentToStub(
  attachment: Attachment,
  parent: AttachmentParent,
  domain: string
): ExternalDocument {
  const fallback = `https://${domain}/wiki/pages/viewpage.action?pageId=${encodeURIComponent(parent.id)}`
  const link = attachment.webuiLink ?? attachment._links?.webui
  let sourceUrl = fallback
  if (link) {
    try {
      const relative = link.startsWith('/') && !link.startsWith('/wiki/') ? `/wiki${link}` : link
      const url = new URL(relative, `https://${domain}/wiki/`)
      if (url.origin === `https://${domain}`) sourceUrl = url.toString()
    } catch {
      sourceUrl = fallback
    }
  }
  return {
    externalId: `${ATTACHMENT_PREFIX}${parent.type}:${encodeURIComponent(parent.id)}:${encodeURIComponent(attachment.id)}`,
    title: attachment.title,
    content: '',
    contentDeferred: true,
    mimeType: attachmentMimeType(attachment) ?? 'application/octet-stream',
    contentHash: `confluence:attachment-v1:${attachment.id}:${parent.type}:${parent.id}:${attachment.version.number}`,
    sourceUrl,
    metadata: {
      contentType: 'attachment',
      parentId: parent.id,
      parentContentType: parent.type,
      version: attachment.version.number,
      lastModified: attachment.version.createdAt,
      fileSize: attachment.fileSize,
    },
  }
}

function decodeCursor(cursor: string | undefined, totalFetched: unknown): AttachmentCursor {
  if (!cursor?.startsWith(CURSOR_PREFIX)) {
    return {
      parents: [],
      parentCursor: cursor,
      parentsDone: false,
      parentsListed: typeof totalFetched === 'number' ? totalFetched : 0,
    }
  }
  if (Buffer.byteLength(cursor, 'utf8') > MAX_CURSOR_BYTES) {
    throw new Error('Confluence attachment continuation exceeds its size limit')
  }
  const parsed = cursorSchema.safeParse(JSON.parse(cursor.slice(CURSOR_PREFIX.length)))
  if (!parsed.success || (parsed.data.attachmentCursor && parsed.data.parents.length === 0)) {
    throw new Error('Invalid Confluence attachment continuation. Restart the sync.')
  }
  return parsed.data
}

/**
 * Visits attachment metadata beneath the already-filtered parents. The cursor
 * contains only a bounded parent queue, never bodies or binary data. Parent caps
 * remain independent of the sync engine's combined page-and-attachment count.
 */
export async function listConfluenceAttachments(
  input: AttachmentRequest & {
    cursor?: string
    listParents: (
      cursor: string | undefined,
      syncContext: Record<string, unknown>
    ) => Promise<ExternalDocumentList>
  }
): Promise<ExternalDocumentList> {
  const state = decodeCursor(input.cursor, input.syncContext?.totalDocsFetched)
  const documents: ExternalDocument[] = []
  if (state.parents.length === 0 && !state.parentsDone) {
    const parentContext = { ...input.syncContext, totalDocsFetched: state.parentsListed }
    const page = await input.listParents(state.parentCursor, parentContext)
    if (page.documents.length > 500 || (page.hasMore && !page.nextCursor)) {
      throw new Error('Confluence returned an invalid parent listing')
    }
    if (input.syncContext) Object.assign(input.syncContext, parentContext)
    state.parentsListed += page.documents.length
    state.parentCursor = page.nextCursor
    state.parentsDone = !page.hasMore
    state.parents = page.documents.map((doc) =>
      parentSchema.parse({ id: doc.externalId, type: doc.metadata?.contentType ?? 'page' })
    )
    documents.push(...page.documents)
  }

  for (let request = 0; state.parents.length > 0 && request < REQUESTS_PER_CALL; request++) {
    const parent = state.parents[0]
    const query = new URLSearchParams({ limit: String(PAGE_SIZE), status: 'current' })
    if (state.attachmentCursor) query.set('cursor', state.attachmentCursor)
    const response = await requestMetadata(
      input,
      `/api/v2/${parent.type}s/${encodeURIComponent(parent.id)}/attachments?${query}`
    )
    let page: z.infer<typeof attachmentPageSchema>
    try {
      page = attachmentPageSchema.parse(await readMetadata(response))
    } catch (error) {
      const missingScope = error instanceof ConfluenceAttachmentScopeError
      if (!missingScope && response.status !== 403 && response.status !== 404) throw error
      state.failures ??= { count: 0, samples: [] }
      state.failures.count += 1
      if (state.failures.samples.length < MAX_LISTING_FAILURE_SAMPLES) {
        state.failures.samples.push({
          scope: parent.id,
          operation: 'confluence.attachments.list',
          status: response.status,
          reasons: [missingScope ? 'attachment_scope_mismatch' : 'attachment_access_denied'],
        })
      }
      state.parents.shift()
      state.attachmentCursor = undefined
      continue
    }
    for (const attachment of page.results) {
      if (attachment.status !== 'current' || !attachmentMimeType(attachment)) continue
      if (!sameParent(attachmentParent(attachment), parent)) {
        throw new Error('Confluence returned an attachment belonging to another parent')
      }
      documents.push(
        stubOrSkipBySize(
          attachmentToStub(attachment, parent, input.domain),
          attachment.fileSize,
          CONNECTOR_MAX_FILE_BYTES
        )
      )
    }
    const next = page._links?.next
    const nextCursor = extractCursor(next)
    if (next && (!nextCursor || nextCursor === state.attachmentCursor)) {
      throw new Error('Confluence returned an invalid or repeated attachment continuation')
    }
    state.attachmentCursor = nextCursor
    if (!nextCursor) state.parents.shift()
  }
  if (state.failures && input.syncContext) input.syncContext.reconciliationUnsafe = true
  const hasMore = state.parents.length > 0 || !state.parentsDone
  const nextCursor = hasMore ? CURSOR_PREFIX + JSON.stringify(state) : undefined
  if (nextCursor && Buffer.byteLength(nextCursor, 'utf8') > MAX_CURSOR_BYTES) {
    throw new Error('Confluence attachment continuation exceeds its size limit')
  }
  return {
    documents,
    hasMore,
    nextCursor,
    ...(state.failures ? { listingFailures: state.failures, reconciliationSafe: false } : {}),
  }
}

export function isConfluenceAttachment(externalId: string): boolean {
  return externalId.startsWith(ATTACHMENT_PREFIX)
}

async function readAttachment(
  input: AttachmentRequest,
  externalId: string
): Promise<Attachment | null> {
  const [type, parentId, attachmentId, extra] = externalId
    .slice(ATTACHMENT_PREFIX.length)
    .split(':')
  if (extra !== undefined || !parentId || !attachmentId)
    throw new Error('Invalid Confluence attachment identity')
  const expectedParent = parentSchema.parse({ type, id: decodeURIComponent(parentId) })
  const id = boundedId.parse(decodeURIComponent(attachmentId))
  const response = await requestMetadata(input, `/api/v2/attachments/${encodeURIComponent(id)}`)
  if (response.status === 404) {
    await response.body?.cancel()
    return null
  }
  const attachment = attachmentSchema.parse(await readMetadata(response))
  if (attachment.id !== id) throw new Error('Confluence returned another attachment')
  if (attachment.status !== 'current' || attachment.customContentId) return null
  return sameParent(attachmentParent(attachment), expectedParent) ? attachment : null
}

/** Verifies the current parent's configured scope rather than trusting stored metadata. */
async function parentLocation(
  input: AttachmentRequest,
  parent: AttachmentParent,
  sourceConfig: Record<string, unknown>
): Promise<{ spaceId: string; contentType: 'page' | 'blogpost' } | null> {
  const selectedType = sourceConfig.contentType || 'page'
  if (selectedType !== 'all' && selectedType !== parent.type) return null
  const path = `/api/v2/${parent.type}s/${encodeURIComponent(parent.id)}`
  const response = await requestMetadata(input, path)
  if (response.status === 404) {
    await response.body?.cancel()
    return null
  }
  const page = z
    .object({ id: boundedId, status: z.string(), spaceId: boundedId })
    .parse(await readMetadata(response))
  if (page.id !== parent.id || page.status !== 'current') return null
  if (!isAllSourceItems(sourceConfig.spaceKey)) {
    const space = z
      .object({ key: z.string() })
      .parse(
        await readMetadata(
          await requestMetadata(input, `/api/v2/spaces/${encodeURIComponent(page.spaceId)}`)
        )
      )
    if (!parseMultiValue(sourceConfig.spaceKey).includes(space.key)) return null
  }
  const labels = parseMultiValue(sourceConfig.labelFilter)
  if (labels.length > 0) {
    const seen = new Set<string>()
    let cursor: string | undefined
    let matched = false
    for (let count = 0; count < 100; count++) {
      const query = new URLSearchParams({ limit: '250' })
      if (cursor) query.set('cursor', cursor)
      const result = z
        .object({
          results: z.array(z.object({ name: z.string() })).max(250),
          _links: z.object({ next: providerCursor.optional() }).optional(),
        })
        .parse(await readMetadata(await requestMetadata(input, `${path}/labels?${query}`)))
      if (result.results.some((label) => labels.includes(label.name))) {
        matched = true
        break
      }
      const next = result._links?.next
      if (!next) break
      cursor = extractCursor(next)
      if (!cursor || seen.has(cursor) || count === 99) {
        throw new Error('Confluence parent labels could not be completely verified')
      }
      seen.add(cursor)
    }
    if (!matched) return null
  }
  return { spaceId: page.spaceId, contentType: parent.type }
}

/** Attachment ACLs authorize the freshly verified parent, never the attachment ID as a page. */
export async function locateConfluenceAttachment(
  input: AttachmentRequest,
  sourceConfig: Record<string, unknown>,
  doc: ExternalDocument
): Promise<{ id: string; spaceId: string; contentType: 'page' | 'blogpost' } | null> {
  const attachment = await readAttachment(input, doc.externalId)
  if (!attachment) return null
  const parent = attachmentParent(attachment)
  if (doc.metadata?.parentId !== parent.id || doc.metadata?.parentContentType !== parent.type)
    return null
  const location = await parentLocation(input, parent, sourceConfig)
  return location ? { id: parent.id, ...location } : null
}

function assertDownloadUrl(value: string): void {
  const url = new URL(value)
  if (url.protocol !== 'https:' || url.username || url.password) {
    throw new Error('Confluence returned an unsafe attachment download URL')
  }
}

/** Downloads a version-pinned original for the shared PDF/OCR, Word, Excel and PowerPoint parsing pipeline. */
export async function getConfluenceAttachment(
  input: AttachmentRequest,
  sourceConfig: Record<string, unknown>,
  externalId: string
): Promise<ExternalDocument | null> {
  const attachment = await readAttachment(input, externalId)
  if (!attachment) return null
  const parent = attachmentParent(attachment)
  if (!(await parentLocation(input, parent, sourceConfig))) return null
  const stub = attachmentToStub(attachment, parent, input.domain)
  const mimeType = attachmentMimeType(attachment)
  if (!mimeType) {
    return {
      ...markSkipped(stub, 'Attachment is no longer a PDF, Word, Excel or PowerPoint document'),
      skippedExistingDisposition: 'replace',
    }
  }
  if (attachment.fileSize && attachment.fileSize > CONNECTOR_MAX_FILE_BYTES) {
    return markSkipped(stub, sizeLimitSkipReason(CONNECTOR_MAX_FILE_BYTES))
  }
  const downloadUrl = `${apiBase(input.cloudId)}/rest/api/content/${encodeURIComponent(parent.id)}/child/attachment/${encodeURIComponent(attachment.id)}/download?version=${attachment.version.number}`
  const redirect = await fetchWithRetry(downloadUrl, {
    headers: { Authorization: `Bearer ${input.accessToken}` },
    redirect: 'manual',
    signal: signalFor(input),
  })
  if (redirect.status === 401) throw await unauthorizedAttachmentError(redirect)
  const location = redirect.headers.get('location')
  await redirect.body?.cancel()
  if (redirect.status === 404) return null
  if (redirect.status !== 302 || !location) {
    throw new Error(
      `Confluence attachment download did not return a download redirect: ${redirect.status}`
    )
  }
  const target = new URL(location, downloadUrl).toString()
  assertDownloadUrl(target)
  try {
    const response = await secureFetchWithRetry(target, {
      profile: 'contentFetch',
      method: 'GET',
      maxResponseBytes: CONNECTOR_MAX_FILE_BYTES,
      signal: signalFor(input),
      assertRedirectTarget: assertDownloadUrl,
      stripAuthOnRedirect: true,
      logUrlValidationDetails: false,
    })
    if (!response.ok) {
      await response.body?.cancel()
      throw new Error(`Failed to download Confluence attachment: ${response.status}`)
    }
    const bytes = await readBodyWithLimit(response, CONNECTOR_MAX_FILE_BYTES)
    if (!bytes) return markSkipped(stub, sizeLimitSkipReason(CONNECTOR_MAX_FILE_BYTES))
    if (bytes.length === 0)
      return {
        ...markSkipped(stub, 'Document contains no extractable text'),
        skippedExistingDisposition: 'replace',
      }
    return {
      ...stub,
      contentDeferred: false,
      sourceFile: { bytes, fileName: attachment.title, mimeType },
    }
  } catch (error) {
    if (isPayloadSizeLimitError(error))
      return markSkipped(stub, sizeLimitSkipReason(CONNECTOR_MAX_FILE_BYTES))
    throw error
  }
}
