import { createLogger } from '@sim/logger'
import { getErrorMessage } from '@sim/utils/errors'
import type {
  ConfluenceBlogPostOperationBody,
  ConfluenceCreateCommentBody,
  ConfluenceCreatePageBody,
  ConfluenceCreatePagePropertyBody,
  ConfluenceCreateSpaceBody,
  ConfluenceDeleteAttachmentBody,
  ConfluenceDeleteBlogPostBody,
  ConfluenceDeleteCommentBody,
  ConfluenceDeleteLabelBody,
  ConfluenceDeletePageBody,
  ConfluenceDeletePagePropertyBody,
  ConfluenceDeleteSpaceBody,
  ConfluenceGetSpaceQuery,
  ConfluenceLabelMutationBody,
  ConfluenceListAttachmentsQuery,
  ConfluenceListBlogPostsQuery,
  ConfluenceListCommentsQuery,
  ConfluenceListLabelsQuery,
  ConfluenceListPagePropertiesQuery,
  ConfluenceListSpacesQuery,
  ConfluencePageAncestorsBody,
  ConfluencePageBody,
  ConfluencePageChildrenBody,
  ConfluencePageDescendantsBody,
  ConfluencePagesByLabelQuery,
  ConfluencePageVersionsBody,
  ConfluenceSearchBody,
  ConfluenceSearchInSpaceBody,
  ConfluenceSpaceBlogPostsBody,
  ConfluenceSpaceLabelsQuery,
  ConfluenceSpacePagesBody,
  ConfluenceSpacePermissionsBody,
  ConfluenceSpacePropertiesBody,
  ConfluenceTasksBody,
  ConfluenceUpdateBlogPostBody,
  ConfluenceUpdateCommentBody,
  ConfluenceUpdatePageBody,
  ConfluenceUpdateSpaceBody,
  ConfluenceUploadAttachmentBody,
  ConfluenceUserBody,
} from '@/lib/api/contracts/tools/confluence'
import {
  validateAlphanumericId,
  validateNumericId,
  validatePaginationCursor,
  validatePathSegment,
} from '@/lib/core/security/input-validation'
import { isPayloadSizeLimitError } from '@/lib/core/utils/stream-limits'
import {
  asArray,
  asObject,
  createConfluenceClient,
  type JsonObject,
  nested,
  nextCursor,
  readConfluenceResponseObject,
  readConfluenceResponseText,
  throwConfluenceResponseError,
} from '@/lib/internal/confluence/client'
import { ConfluenceOperationError } from '@/lib/internal/confluence/errors'
import { MAX_BUFFERED_TRANSFER_BYTES } from '@/lib/uploads/shared/types'
import { docNotReadyMessage, isDocNotReadyError } from '@/lib/uploads/utils/doc-not-ready'
import { processSingleFileToUserFile, type RawFileInput } from '@/lib/uploads/utils/file-utils'
import { downloadServableFileFromStorage } from '@/lib/uploads/utils/file-utils.server'
import { assertToolFileAccess } from '@/app/api/files/authorization'
import { cleanHtmlContent } from '@/tools/confluence/utils'
import { parseAtlassianErrorMessage } from '@/tools/jira/utils'

const logger = createLogger('ConfluenceOperations')

export interface ConfluenceOperationContext {
  headers: Headers
  requestId: string
  signal?: AbortSignal
  userId?: string
}

type Connection = { domain: string; accessToken: string; cloudId?: string }

function jsonInit(method: 'POST' | 'PUT', body: unknown): RequestInit {
  return {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  }
}

function assertId(value: string, field: string): void {
  const validation = validateAlphanumericId(value, field, 255)
  if (!validation.isValid) {
    throw new ConfluenceOperationError(validation.error || `Invalid ${field}`, 400)
  }
}

function assertCursor(value: string | undefined): void {
  if (!value) return
  const validation = validatePaginationCursor(value, 'cursor')
  if (!validation.isValid) {
    throw new ConfluenceOperationError(validation.error || 'Invalid cursor', 400)
  }
}

function cappedLimit(value: string | number): string {
  return String(Math.min(Number(value), 250))
}

function mappedPage(value: unknown): JsonObject {
  const page = asObject(value)
  return {
    id: page.id,
    title: page.title,
    status: page.status ?? null,
    spaceId: page.spaceId ?? null,
    parentId: page.parentId ?? null,
    authorId: page.authorId ?? null,
    createdAt: page.createdAt ?? null,
    version: page.version ?? null,
    webUrl: nested(page, '_links', 'webui') ?? null,
  }
}

export async function executeConfluenceRetrievePage(
  input: ConfluencePageBody,
  context: ConfluenceOperationContext
) {
  const client = await createConfluenceClient(input, context.signal)
  const data = await client.json(
    client.apiV2(`/pages/${input.pageId}?body-format=storage`),
    {},
    context.signal
  )
  return {
    id: data.id,
    title: data.title,
    body: {
      storage: {
        value: nested(data, 'body', 'storage', 'value') ?? null,
        representation: 'storage',
      },
    },
    status: data.status ?? null,
    spaceId: data.spaceId ?? null,
    parentId: data.parentId ?? null,
    authorId: data.authorId ?? null,
    createdAt: data.createdAt ?? null,
    version: data.version ?? null,
    _links: data._links ?? null,
  }
}

export async function executeConfluenceUpdatePage(
  input: ConfluenceUpdatePageBody,
  context: ConfluenceOperationContext
) {
  const client = await createConfluenceClient(input, context.signal)
  const url = client.apiV2(`/pages/${input.pageId}?body-format=storage`)
  const currentResponse = await client.fetch(url, {}, context.signal)
  if (!currentResponse.ok) {
    const text = await readConfluenceResponseText(
      currentResponse,
      context.signal,
      'Confluence page response'
    )
    throw new Error(
      parseAtlassianErrorMessage(currentResponse.status, currentResponse.statusText, text)
    )
  }
  const current = await readConfluenceResponseObject(
    currentResponse,
    context.signal,
    'Confluence page response'
  )
  const currentVersion = Number(nested(current, 'version', 'number'))
  const title = input.title || current.title
  const value = input.body?.value || nested(current, 'body', 'storage', 'value') || ''
  return client.json(
    url,
    jsonInit('PUT', {
      id: input.pageId,
      version: {
        number: currentVersion + 1,
        message: input.version?.message || 'Updated via API',
      },
      status: 'current',
      title,
      body: { representation: 'storage', value },
    }),
    context.signal
  )
}

export async function executeConfluenceDeletePage(
  input: ConfluenceDeletePageBody,
  context: ConfluenceOperationContext
) {
  const client = await createConfluenceClient(input, context.signal)
  await client.delete(
    client.apiV2(`/pages/${input.pageId}${input.purge ? '?purge=true' : ''}`),
    context.signal
  )
  return { pageId: input.pageId, deleted: true }
}

export async function executeConfluenceCreatePage(
  input: ConfluenceCreatePageBody,
  context: ConfluenceOperationContext
) {
  if (!/^\d+$/.test(String(input.spaceId))) {
    throw new ConfluenceOperationError(
      'Invalid Space ID. The Space ID must be a numeric value, not the space key from the URL. Use the "list" operation to get all spaces with their numeric IDs.',
      400
    )
  }
  assertId(input.spaceId, 'spaceId')
  if (input.parentId) assertId(input.parentId, 'parentId')
  const client = await createConfluenceClient(input, context.signal)
  const body: JsonObject = {
    spaceId: input.spaceId,
    status: 'current',
    title: input.title,
    body: { representation: 'storage', value: input.content },
  }
  if (input.parentId) body.parentId = input.parentId
  try {
    return await client.json(client.apiV2('/pages'), jsonInit('POST', body), context.signal)
  } catch (error) {
    if (
      error instanceof ConfluenceOperationError &&
      error.message.includes("'spaceId'") &&
      error.message.includes('Long')
    ) {
      throw new ConfluenceOperationError(
        'Invalid Space ID. Use the list spaces operation to find valid space IDs.',
        error.status
      )
    }
    throw error
  }
}

export async function executeConfluenceListAttachments(
  input: ConfluenceListAttachmentsQuery,
  context: ConfluenceOperationContext
) {
  assertId(input.pageId, 'pageId')
  const client = await createConfluenceClient(input, context.signal)
  const query = new URLSearchParams({ limit: cappedLimit(input.limit) })
  if (input.cursor) query.set('cursor', input.cursor)
  const data = await client.json(
    client.apiV2(`/pages/${input.pageId}/attachments?${query}`),
    {},
    context.signal
  )
  return {
    attachments: asArray(data.results).map((value) => {
      const attachment = asObject(value)
      return {
        id: attachment.id,
        title: attachment.title,
        fileSize: attachment.fileSize || 0,
        mediaType: attachment.mediaType || '',
        downloadUrl: attachment.downloadLink || nested(attachment, '_links', 'download') || '',
        status: attachment.status ?? null,
        webuiUrl: nested(attachment, '_links', 'webui') ?? null,
        pageId: attachment.pageId ?? null,
        blogPostId: attachment.blogPostId ?? null,
        comment: attachment.comment ?? null,
        version: attachment.version ?? null,
      }
    }),
    nextCursor: nextCursor(data),
  }
}

export async function executeConfluenceDeleteAttachment(
  input: ConfluenceDeleteAttachmentBody,
  context: ConfluenceOperationContext
) {
  assertId(input.attachmentId, 'attachmentId')
  const client = await createConfluenceClient(input, context.signal)
  await client.delete(client.apiV2(`/attachments/${input.attachmentId}`), context.signal)
  return { attachmentId: input.attachmentId, deleted: true }
}

export async function executeConfluenceUploadAttachment(
  input: ConfluenceUploadAttachmentBody,
  context: ConfluenceOperationContext
) {
  const { signal, userId } = context
  if (!userId) throw new ConfluenceOperationError('Unauthorized', 401)
  assertId(input.pageId, 'pageId')
  let file = input.file as RawFileInput | RawFileInput[]
  if (Array.isArray(file)) {
    if (file.length === 0) throw new ConfluenceOperationError('No file provided', 400)
    file = file[0]
  }
  let userFile: ReturnType<typeof processSingleFileToUserFile>
  try {
    userFile = processSingleFileToUserFile(file, 'confluence-upload', logger)
  } catch (error) {
    throw new ConfluenceOperationError(getErrorMessage(error, 'Failed to process file'), 400)
  }
  const denied = await assertToolFileAccess(userFile.key, userId, 'confluence-upload', logger)
  if (denied) {
    throw new ConfluenceOperationError('File not found', 404, {
      success: false,
      error: 'File not found',
    })
  }
  signal?.throwIfAborted()
  let fileBuffer: Buffer
  let contentType: string
  try {
    const servable = await downloadServableFileFromStorage(userFile, 'confluence-upload', logger, {
      maxBytes: MAX_BUFFERED_TRANSFER_BYTES,
    })
    fileBuffer = servable.buffer
    contentType = servable.contentType
  } catch (error) {
    signal?.throwIfAborted()
    if (isDocNotReadyError(error)) {
      const message = docNotReadyMessage()
      throw new ConfluenceOperationError(message, 409, { success: false, error: message })
    }
    throw new ConfluenceOperationError(
      `Failed to download file: ${getErrorMessage(error, 'Unknown error')}`,
      isPayloadSizeLimitError(error) ? 413 : 500
    )
  }
  const client = await createConfluenceClient(input, signal)
  const mimeType = contentType || userFile.type || 'application/octet-stream'
  const form = new FormData()
  form.append(
    'file',
    new Blob([new Uint8Array(fileBuffer)], { type: mimeType }),
    input.fileName || userFile.name || 'attachment'
  )
  if (input.comment) form.append('comment', input.comment)
  form.append('minorEdit', 'false')
  const response = await client.fetch(
    client.rest(`/content/${input.pageId}/child/attachment`),
    {
      method: 'POST',
      headers: { 'X-Atlassian-Token': 'nocheck' },
      body: form,
    },
    signal
  )
  if (!response.ok) await throwConfluenceResponseError(response, signal)
  const data = await readConfluenceResponseObject(
    response,
    signal,
    'Confluence attachment response'
  )
  const attachment = asObject(asArray(data.results)[0] || data)
  return {
    attachmentId: attachment.id,
    title: attachment.title,
    fileSize: nested(attachment, 'extensions', 'fileSize') || 0,
    mediaType: nested(attachment, 'extensions', 'mediaType') || mimeType,
    downloadUrl: nested(attachment, '_links', 'download') || '',
    pageId: input.pageId,
  }
}

export async function executeConfluenceAddLabel(
  input: ConfluenceLabelMutationBody,
  context: ConfluenceOperationContext
) {
  assertId(input.pageId, 'pageId')
  const client = await createConfluenceClient(input, context.signal)
  const data = await client.json(
    client.rest(`/content/${input.pageId}/label`),
    jsonInit('POST', [{ prefix: input.prefix || 'global', name: input.labelName }]),
    context.signal
  )
  const label = asObject(asArray(data.results)[0] || asArray(data)[0] || data)
  return {
    id: label.id ?? '',
    name: label.name ?? input.labelName,
    prefix: label.prefix ?? input.prefix ?? 'global',
    pageId: input.pageId,
    labelName: input.labelName,
  }
}

export async function executeConfluenceListLabels(
  input: ConfluenceListLabelsQuery,
  context: ConfluenceOperationContext
) {
  assertId(input.pageId, 'pageId')
  const client = await createConfluenceClient(input, context.signal)
  const query = new URLSearchParams({ limit: cappedLimit(input.limit) })
  if (input.cursor) query.set('cursor', input.cursor)
  const data = await client.json(
    client.apiV2(`/pages/${input.pageId}/labels?${query}`),
    {},
    context.signal
  )
  return {
    labels: asArray(data.results).map((value) => {
      const label = asObject(value)
      return { id: label.id, name: label.name, prefix: label.prefix || 'global' }
    }),
    nextCursor: nextCursor(data),
  }
}

export async function executeConfluenceDeleteLabel(
  input: ConfluenceDeleteLabelBody,
  context: ConfluenceOperationContext
) {
  assertId(input.pageId, 'pageId')
  const client = await createConfluenceClient(input, context.signal)
  await client.delete(
    client.rest(
      `/content/${input.pageId}/label?name=${encodeURIComponent(input.labelName.trim())}`
    ),
    context.signal
  )
  return { pageId: input.pageId, labelName: input.labelName, deleted: true }
}

export async function executeConfluenceCreateComment(
  input: ConfluenceCreateCommentBody,
  context: ConfluenceOperationContext
) {
  assertId(input.pageId, 'pageId')
  const client = await createConfluenceClient(input, context.signal)
  const data = await client.json(
    client.apiV2('/footer-comments'),
    jsonInit('POST', {
      pageId: input.pageId,
      body: { representation: 'storage', value: input.comment },
    }),
    context.signal
  )
  return { ...data, pageId: input.pageId }
}

export async function executeConfluenceListComments(
  input: ConfluenceListCommentsQuery,
  context: ConfluenceOperationContext
) {
  assertId(input.pageId, 'pageId')
  const client = await createConfluenceClient(input, context.signal)
  const query = new URLSearchParams({
    limit: cappedLimit(input.limit),
    'body-format': input.bodyFormat,
  })
  if (input.cursor) query.set('cursor', input.cursor)
  const data = await client.json(
    client.apiV2(`/pages/${input.pageId}/footer-comments?${query}`),
    {},
    context.signal
  )
  return {
    comments: asArray(data.results).map((value) => {
      const comment = asObject(value)
      return {
        id: comment.id,
        body: {
          value:
            nested(comment, 'body', 'storage', 'value') ||
            nested(comment, 'body', 'view', 'value') ||
            '',
          representation: input.bodyFormat,
        },
        createdAt: comment.createdAt || '',
        authorId: comment.authorId || '',
        status: comment.status ?? null,
        title: comment.title ?? null,
        pageId: comment.pageId ?? null,
        blogPostId: comment.blogPostId ?? null,
        parentCommentId: comment.parentCommentId ?? null,
        version: comment.version ?? null,
      }
    }),
    nextCursor: nextCursor(data),
  }
}

async function detectCommentEndpoint(
  input: Connection & { commentId: string },
  context: ConfluenceOperationContext
) {
  const client = await createConfluenceClient(input, context.signal)
  let endpoint = 'footer-comments'
  let response = await client.fetch(
    client.apiV2(`/footer-comments/${input.commentId}`),
    {},
    context.signal
  )
  if (response.status === 404) {
    await readConfluenceResponseText(response, context.signal, 'Confluence comment lookup response')
    endpoint = 'inline-comments'
    response = await client.fetch(
      client.apiV2(`/inline-comments/${input.commentId}`),
      {},
      context.signal
    )
  }
  return { client, endpoint, response }
}

export async function executeConfluenceUpdateComment(
  input: ConfluenceUpdateCommentBody,
  context: ConfluenceOperationContext
) {
  const { client, endpoint, response } = await detectCommentEndpoint(input, context)
  if (!response.ok) {
    const text = await readConfluenceResponseText(
      response,
      context.signal,
      'Confluence comment response'
    )
    throw new Error(parseAtlassianErrorMessage(response.status, response.statusText, text))
  }
  const current = await readConfluenceResponseObject(
    response,
    context.signal,
    'Confluence comment response'
  )
  return client.json(
    client.apiV2(`/${endpoint}/${input.commentId}`),
    jsonInit('PUT', {
      body: { representation: 'storage', value: input.comment },
      version: {
        number: Number(nested(current, 'version', 'number') || 1) + 1,
        message: 'Updated via Sim',
      },
    }),
    context.signal
  )
}

export async function executeConfluenceDeleteComment(
  input: ConfluenceDeleteCommentBody,
  context: ConfluenceOperationContext
) {
  const { client, endpoint, response } = await detectCommentEndpoint(input, context)
  if (!response.ok) await throwConfluenceResponseError(response, context.signal)
  await client.delete(client.apiV2(`/${endpoint}/${input.commentId}`), context.signal)
  return { commentId: input.commentId, deleted: true }
}

export async function executeConfluenceListPageProperties(
  input: ConfluenceListPagePropertiesQuery,
  context: ConfluenceOperationContext
) {
  assertId(input.pageId, 'pageId')
  const client = await createConfluenceClient(input, context.signal)
  const query = new URLSearchParams({ limit: cappedLimit(input.limit) })
  if (input.cursor) query.set('cursor', input.cursor)
  const data = await client.json(
    client.apiV2(`/pages/${input.pageId}/properties?${query}`),
    {},
    context.signal
  )
  return {
    properties: asArray(data.results).map((value) => {
      const property = asObject(value)
      return {
        id: property.id,
        key: property.key,
        value: property.value ?? null,
        version: property.version ?? null,
      }
    }),
    pageId: input.pageId,
    nextCursor: nextCursor(data),
  }
}

export async function executeConfluenceCreatePageProperty(
  input: ConfluenceCreatePagePropertyBody,
  context: ConfluenceOperationContext
) {
  assertId(input.pageId, 'pageId')
  const client = await createConfluenceClient(input, context.signal)
  const data = await client.json(
    client.apiV2(`/pages/${input.pageId}/properties`),
    jsonInit('POST', { key: input.key, value: input.value }),
    context.signal
  )
  return {
    id: data.id,
    key: data.key,
    value: data.value,
    version: data.version,
    pageId: input.pageId,
  }
}

export async function executeConfluenceDeletePageProperty(
  input: ConfluenceDeletePagePropertyBody,
  context: ConfluenceOperationContext
) {
  assertId(input.pageId, 'pageId')
  assertId(input.propertyId, 'propertyId')
  const client = await createConfluenceClient(input, context.signal)
  await client.delete(
    client.apiV2(`/pages/${input.pageId}/properties/${input.propertyId}`),
    context.signal
  )
  return { propertyId: input.propertyId, pageId: input.pageId, deleted: true }
}

export async function executeConfluenceGetPageAncestors(
  input: ConfluencePageAncestorsBody,
  context: ConfluenceOperationContext
) {
  assertId(input.pageId, 'pageId')
  const client = await createConfluenceClient(input, context.signal)
  const data = await client.json(
    client.apiV2(`/pages/${input.pageId}/ancestors?limit=${cappedLimit(input.limit)}`),
    {},
    context.signal
  )
  return {
    ancestors: asArray(data.results).map((value) => {
      const page = asObject(value)
      return {
        id: page.id,
        title: page.title,
        status: page.status ?? null,
        spaceId: page.spaceId ?? null,
        webUrl: nested(page, '_links', 'webui') ?? null,
      }
    }),
    pageId: input.pageId,
  }
}

export async function executeConfluenceGetPageChildren(
  input: ConfluencePageChildrenBody,
  context: ConfluenceOperationContext
) {
  assertId(input.pageId, 'pageId')
  const client = await createConfluenceClient(input, context.signal)
  const query = new URLSearchParams({ limit: cappedLimit(input.limit) })
  if (input.cursor) query.set('cursor', input.cursor)
  const data = await client.json(
    client.apiV2(`/pages/${input.pageId}/children?${query}`),
    {},
    context.signal
  )
  return {
    children: asArray(data.results).map((value) => {
      const page = asObject(value)
      return {
        id: page.id,
        title: page.title,
        status: page.status ?? null,
        spaceId: page.spaceId ?? null,
        childPosition: page.childPosition ?? null,
        webUrl: nested(page, '_links', 'webui') ?? null,
      }
    }),
    parentId: input.pageId,
    nextCursor: nextCursor(data),
  }
}

export async function executeConfluenceGetPageDescendants(
  input: ConfluencePageDescendantsBody,
  context: ConfluenceOperationContext
) {
  assertId(input.pageId, 'pageId')
  assertCursor(input.cursor)
  const client = await createConfluenceClient(input, context.signal)
  const query = new URLSearchParams({ limit: cappedLimit(input.limit) })
  if (input.cursor) query.set('cursor', input.cursor)
  const data = await client.json(
    client.apiV2(`/pages/${input.pageId}/descendants?${query}`),
    {},
    context.signal
  )
  return {
    descendants: asArray(data.results).map((value) => {
      const page = asObject(value)
      return {
        id: page.id,
        title: page.title,
        type: page.type ?? null,
        status: page.status ?? null,
        spaceId: page.spaceId ?? null,
        parentId: page.parentId ?? null,
        childPosition: page.childPosition ?? null,
        depth: page.depth ?? null,
      }
    }),
    pageId: input.pageId,
    nextCursor: nextCursor(data),
  }
}

export async function executeConfluencePageVersions(
  input: ConfluencePageVersionsBody,
  context: ConfluenceOperationContext
) {
  assertId(input.pageId, 'pageId')
  const client = await createConfluenceClient(input, context.signal)
  if (input.versionNumber !== undefined && input.versionNumber !== null) {
    const validation = validateNumericId(input.versionNumber, 'versionNumber', { min: 1 })
    if (!validation.isValid) {
      throw new ConfluenceOperationError(validation.error || 'Invalid versionNumber', 400)
    }
    const version = validation.sanitized
    const [versionResponse, pageResponse] = await Promise.all([
      client.fetch(client.apiV2(`/pages/${input.pageId}/versions/${version}`), {}, context.signal),
      client.fetch(
        client.apiV2(`/pages/${input.pageId}?version=${version}&body-format=storage`),
        {},
        context.signal
      ),
    ])
    if (!versionResponse.ok) {
      await pageResponse.body?.cancel()
      await throwConfluenceResponseError(versionResponse, context.signal)
    }
    const versionData = await readConfluenceResponseObject(
      versionResponse,
      context.signal,
      'Confluence page version response'
    )
    let title: unknown = null
    let body: unknown = null
    let content: string | null = null
    if (pageResponse.ok) {
      const page = await readConfluenceResponseObject(
        pageResponse,
        context.signal,
        'Confluence page response'
      )
      title = page.title ?? null
      body = page.body ?? null
      const raw =
        nested(page, 'body', 'storage', 'value') ||
        nested(page, 'body', 'view', 'value') ||
        nested(page, 'body', 'atlas_doc_format', 'value') ||
        ''
      if (typeof raw === 'string' && raw) content = cleanHtmlContent(raw)
    } else {
      await pageResponse.body?.cancel()
    }
    return {
      version: {
        number: versionData.number,
        message: versionData.message ?? null,
        minorEdit: versionData.minorEdit ?? false,
        authorId: versionData.authorId ?? null,
        createdAt: versionData.createdAt ?? null,
      },
      pageId: input.pageId,
      title,
      content,
      body,
    }
  }
  assertCursor(input.cursor)
  const query = new URLSearchParams({ limit: cappedLimit(input.limit) })
  if (input.cursor) query.set('cursor', input.cursor)
  const data = await client.json(
    client.apiV2(`/pages/${input.pageId}/versions?${query}`),
    {},
    context.signal
  )
  return {
    versions: asArray(data.results).map((value) => {
      const version = asObject(value)
      return {
        number: version.number,
        message: version.message ?? null,
        minorEdit: version.minorEdit ?? false,
        authorId: version.authorId ?? null,
        createdAt: version.createdAt ?? null,
      }
    }),
    pageId: input.pageId,
    nextCursor: nextCursor(data),
  }
}

export async function executeConfluenceGetPagesByLabel(
  input: ConfluencePagesByLabelQuery,
  context: ConfluenceOperationContext
) {
  assertId(input.labelId, 'labelId')
  const client = await createConfluenceClient(input, context.signal)
  const query = new URLSearchParams({ limit: cappedLimit(input.limit) })
  if (input.cursor) query.set('cursor', input.cursor)
  const data = await client.json(
    client.apiV2(`/labels/${input.labelId}/pages?${query}`),
    {},
    context.signal
  )
  return {
    pages: asArray(data.results).map(mappedPage),
    labelId: input.labelId,
    nextCursor: nextCursor(data),
  }
}

function escapeCql(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/"/g, '\\"')
}

export async function executeConfluenceSearch(
  input: ConfluenceSearchBody,
  context: ConfluenceOperationContext
) {
  const client = await createConfluenceClient(input, context.signal)
  const query = new URLSearchParams({
    cql: `text ~ "${escapeCql(input.query)}"`,
    limit: input.limit.toString(),
  })
  const data = await client.json(client.rest(`/search?${query}`), {}, context.signal)
  return {
    results: asArray(data.results).map((value) => {
      const result = asObject(value)
      const content = asObject(result.content)
      const globalContainer = asObject(result.resultGlobalContainer)
      const contentSpace = asObject(content.space)
      const space = Object.keys(globalContainer).length ? globalContainer : contentSpace
      return {
        id: content.id || result.id,
        title: content.title || result.title,
        type: content.type || result.type,
        url: result.url || nested(result, '_links', 'webui') || '',
        excerpt: result.excerpt || '',
        status: content.status ?? null,
        spaceKey: globalContainer.key ?? contentSpace.key ?? null,
        space: Object.keys(space).length
          ? {
              id: space.id ?? null,
              key: space.key ?? null,
              name: space.name ?? space.title ?? null,
            }
          : null,
        lastModified:
          result.lastModified ?? nested(content, 'history', 'lastUpdated', 'when') ?? null,
        entityType: result.entityType ?? null,
      }
    }),
  }
}

export async function executeConfluenceSearchInSpace(
  input: ConfluenceSearchInSpaceBody,
  context: ConfluenceOperationContext
) {
  assertId(input.spaceKey, 'spaceKey')
  const client = await createConfluenceClient(input, context.signal)
  let cql = `space = "${escapeCql(input.spaceKey)}"`
  if (input.query) cql += ` AND text ~ "${escapeCql(input.query)}"`
  if (input.contentType) cql += ` AND type = "${escapeCql(input.contentType)}"`
  const query = new URLSearchParams({ cql, limit: cappedLimit(input.limit) })
  const data = await client.json(client.rest(`/search?${query}`), {}, context.signal)
  const results = asArray(data.results).map((value) => {
    const result = asObject(value)
    const content = asObject(result.content)
    return {
      id: content.id ?? result.id,
      title: content.title ?? result.title,
      type: content.type ?? result.type,
      status: content.status ?? null,
      url: result.url ?? nested(result, '_links', 'webui') ?? '',
      excerpt: result.excerpt ?? '',
      lastModified: result.lastModified ?? null,
    }
  })
  return { results, spaceKey: input.spaceKey, totalSize: data.totalSize ?? results.length }
}

export async function executeConfluenceListBlogPostsInSpace(
  input: ConfluenceSpaceBlogPostsBody,
  context: ConfluenceOperationContext
) {
  assertId(input.spaceId, 'spaceId')
  const client = await createConfluenceClient(input, context.signal)
  const query = new URLSearchParams({ limit: cappedLimit(input.limit) })
  if (input.status) query.set('status', input.status)
  if (input.bodyFormat) query.set('body-format', input.bodyFormat)
  if (input.cursor) query.set('cursor', input.cursor)
  const data = await client.json(
    client.apiV2(`/spaces/${input.spaceId}/blogposts?${query}`),
    {},
    context.signal
  )
  return {
    blogPosts: asArray(data.results).map((value) => {
      const post = asObject(value)
      return {
        id: post.id,
        title: post.title,
        status: post.status ?? null,
        spaceId: post.spaceId ?? null,
        authorId: post.authorId ?? null,
        createdAt: post.createdAt ?? null,
        version: post.version ?? null,
        body: post.body ?? null,
        webUrl: nested(post, '_links', 'webui') ?? null,
      }
    }),
    nextCursor: nextCursor(data),
  }
}

export async function executeConfluenceListPagesInSpace(
  input: ConfluenceSpacePagesBody,
  context: ConfluenceOperationContext
) {
  assertId(input.spaceId, 'spaceId')
  const client = await createConfluenceClient(input, context.signal)
  const query = new URLSearchParams({ limit: cappedLimit(input.limit) })
  if (input.status) query.set('status', input.status)
  if (input.bodyFormat) query.set('body-format', input.bodyFormat)
  if (input.cursor) query.set('cursor', input.cursor)
  const data = await client.json(
    client.apiV2(`/spaces/${input.spaceId}/pages?${query}`),
    {},
    context.signal
  )
  return {
    pages: asArray(data.results).map((value) => {
      const page = asObject(value)
      return { ...mappedPage(page), body: page.body ?? null }
    }),
    nextCursor: nextCursor(data),
  }
}

export async function executeConfluenceListSpaceLabels(
  input: ConfluenceSpaceLabelsQuery,
  context: ConfluenceOperationContext
) {
  assertId(input.spaceId, 'spaceId')
  const client = await createConfluenceClient(input, context.signal)
  const query = new URLSearchParams({ limit: cappedLimit(input.limit) })
  if (input.cursor) query.set('cursor', input.cursor)
  const data = await client.json(
    client.apiV2(`/spaces/${input.spaceId}/labels?${query}`),
    {},
    context.signal
  )
  return {
    labels: asArray(data.results).map((value) => {
      const label = asObject(value)
      return { id: label.id, name: label.name, prefix: label.prefix || 'global' }
    }),
    spaceId: input.spaceId,
    nextCursor: nextCursor(data),
  }
}

export async function executeConfluenceListSpacePermissions(
  input: ConfluenceSpacePermissionsBody,
  context: ConfluenceOperationContext
) {
  assertId(input.spaceId, 'spaceId')
  assertCursor(input.cursor)
  const client = await createConfluenceClient(input, context.signal)
  const query = new URLSearchParams({ limit: cappedLimit(input.limit) })
  if (input.cursor) query.set('cursor', input.cursor)
  const data = await client.json(
    client.apiV2(`/spaces/${input.spaceId}/permissions?${query}`),
    {},
    context.signal
  )
  return {
    permissions: asArray(data.results).map((value) => {
      const permission = asObject(value)
      return {
        id: permission.id,
        principalType: nested(permission, 'principal', 'type') ?? null,
        principalId: nested(permission, 'principal', 'id') ?? null,
        operationKey: nested(permission, 'operation', 'key') ?? null,
        operationTargetType: nested(permission, 'operation', 'targetType') ?? null,
        anonymousAccess: permission.anonymousAccess ?? false,
        unlicensedAccess: permission.unlicensedAccess ?? false,
      }
    }),
    spaceId: input.spaceId,
    nextCursor: nextCursor(data),
  }
}

export async function executeConfluenceListBlogPosts(
  input: ConfluenceListBlogPostsQuery,
  context: ConfluenceOperationContext
) {
  const client = await createConfluenceClient(input, context.signal)
  const query = new URLSearchParams({ limit: cappedLimit(input.limit) })
  if (input.status) query.set('status', input.status)
  if (input.sort) query.set('sort', input.sort)
  if (input.cursor) query.set('cursor', input.cursor)
  const data = await client.json(client.apiV2(`/blogposts?${query}`), {}, context.signal)
  return {
    blogPosts: asArray(data.results).map((value) => {
      const post = asObject(value)
      return {
        id: post.id,
        title: post.title,
        status: post.status ?? null,
        spaceId: post.spaceId ?? null,
        authorId: post.authorId ?? null,
        createdAt: post.createdAt ?? null,
        version: post.version ?? null,
        webUrl: nested(post, '_links', 'webui') ?? null,
      }
    }),
    nextCursor: nextCursor(data),
  }
}

export async function executeConfluenceCreateBlogPost(
  input: ConfluenceBlogPostOperationBody,
  context: ConfluenceOperationContext
) {
  if (!('spaceId' in input) || !('title' in input) || !('content' in input)) {
    throw new ConfluenceOperationError('Invalid create blog post request', 400)
  }
  const client = await createConfluenceClient(input, context.signal)
  const data = await client.json(
    client.apiV2('/blogposts'),
    jsonInit('POST', {
      spaceId: input.spaceId,
      status: input.status || 'current',
      title: input.title,
      body: { representation: 'storage', value: input.content },
    }),
    context.signal
  )
  return {
    id: data.id,
    title: data.title,
    spaceId: data.spaceId,
    webUrl: nested(data, '_links', 'webui') ?? null,
  }
}

export async function executeConfluenceGetBlogPost(
  input: ConfluenceBlogPostOperationBody,
  context: ConfluenceOperationContext
) {
  if (!('blogPostId' in input)) throw new ConfluenceOperationError('Blog post ID is required', 400)
  const client = await createConfluenceClient(input, context.signal)
  const query = input.bodyFormat ? `?body-format=${encodeURIComponent(input.bodyFormat)}` : ''
  const data = await client.json(
    client.apiV2(`/blogposts/${input.blogPostId}${query}`),
    {},
    context.signal
  )
  return {
    id: data.id,
    title: data.title,
    status: data.status ?? null,
    spaceId: data.spaceId ?? null,
    authorId: data.authorId ?? null,
    createdAt: data.createdAt ?? null,
    version: data.version ?? null,
    body: data.body ?? null,
    webUrl: nested(data, '_links', 'webui') ?? null,
  }
}

export async function executeConfluenceUpdateBlogPost(
  input: ConfluenceUpdateBlogPostBody,
  context: ConfluenceOperationContext
) {
  const client = await createConfluenceClient(input, context.signal)
  const url = client.apiV2(`/blogposts/${input.blogPostId}?body-format=storage`)
  const currentResponse = await client.fetch(url, {}, context.signal)
  if (!currentResponse.ok) {
    const text = await readConfluenceResponseText(
      currentResponse,
      context.signal,
      'Confluence blog post response'
    )
    throw new Error(
      parseAtlassianErrorMessage(currentResponse.status, currentResponse.statusText, text)
    )
  }
  const current = await readConfluenceResponseObject(
    currentResponse,
    context.signal,
    'Confluence blog post response'
  )
  const version = nested(current, 'version', 'number')
  if (typeof version !== 'number') {
    throw new ConfluenceOperationError('Unable to determine current blog post version', 422)
  }
  return client.json(
    url,
    jsonInit('PUT', {
      id: input.blogPostId,
      version: { number: version + 1 },
      status: 'current',
      title: input.title || current.title,
      body: {
        representation: 'storage',
        value: input.content || nested(current, 'body', 'storage', 'value') || '',
      },
    }),
    context.signal
  )
}

export async function executeConfluenceDeleteBlogPost(
  input: ConfluenceDeleteBlogPostBody,
  context: ConfluenceOperationContext
) {
  const client = await createConfluenceClient(input, context.signal)
  await client.delete(client.apiV2(`/blogposts/${input.blogPostId}`), context.signal)
  return { blogPostId: input.blogPostId, deleted: true }
}

export async function executeConfluenceGetSpace(
  input: ConfluenceGetSpaceQuery,
  context: ConfluenceOperationContext
) {
  assertId(input.spaceId, 'spaceId')
  const client = await createConfluenceClient(input, context.signal)
  return client.json(client.apiV2(`/spaces/${input.spaceId}`), {}, context.signal)
}

export async function executeConfluenceCreateSpace(
  input: ConfluenceCreateSpaceBody,
  context: ConfluenceOperationContext
) {
  const client = await createConfluenceClient(input, context.signal)
  const body: JsonObject = { name: input.name, key: input.key }
  if (input.description) {
    body.description = { plain: { value: input.description, representation: 'plain' } }
  }
  return client.json(client.apiV2('/spaces'), jsonInit('POST', body), context.signal)
}

export async function executeConfluenceUpdateSpace(
  input: ConfluenceUpdateSpaceBody,
  context: ConfluenceOperationContext
) {
  assertId(input.spaceId, 'spaceId')
  if (!input.name && input.description === undefined) {
    throw new ConfluenceOperationError(
      'At least one of name or description is required for update',
      400
    )
  }
  const client = await createConfluenceClient(input, context.signal)
  const current = await client.json(client.apiV2(`/spaces/${input.spaceId}`), {}, context.signal)
  const body: JsonObject = { name: input.name || current.name }
  if (input.description !== undefined) {
    body.description = { plain: { value: input.description, representation: 'plain' } }
  }
  return client.json(
    client.rest(`/space/${encodeURIComponent(String(current.key))}`),
    jsonInit('PUT', body),
    context.signal
  )
}

export async function executeConfluenceDeleteSpace(
  input: ConfluenceDeleteSpaceBody,
  context: ConfluenceOperationContext
) {
  assertId(input.spaceId, 'spaceId')
  const client = await createConfluenceClient(input, context.signal)
  const current = await client.json(client.apiV2(`/spaces/${input.spaceId}`), {}, context.signal)
  const response = await client.fetch(
    client.rest(`/space/${encodeURIComponent(String(current.key))}`),
    { method: 'DELETE' },
    context.signal
  )
  if (!response.ok) await throwConfluenceResponseError(response, context.signal)
  let longTask: JsonObject = {}
  try {
    const text = await readConfluenceResponseText(
      response,
      context.signal,
      'Confluence delete space response',
      'DELETE'
    )
    if (text) longTask = asObject(JSON.parse(text))
  } catch {
    context.signal?.throwIfAborted()
  }
  return {
    spaceId: input.spaceId,
    deleted: true,
    longTaskId: longTask.id,
    longTaskStatusLink: nested(longTask, 'links', 'status'),
  }
}

export async function executeConfluenceListSpaces(
  input: ConfluenceListSpacesQuery,
  context: ConfluenceOperationContext
) {
  const client = await createConfluenceClient(input, context.signal)
  const query = new URLSearchParams({ limit: cappedLimit(input.limit) })
  if (input.cursor) query.set('cursor', input.cursor)
  const data = await client.json(client.apiV2(`/spaces?${query}`), {}, context.signal)
  return {
    spaces: asArray(data.results).map((value) => {
      const space = asObject(value)
      return {
        id: space.id,
        name: space.name,
        key: space.key,
        type: space.type,
        status: space.status,
        authorId: space.authorId ?? null,
        createdAt: space.createdAt ?? null,
        homepageId: space.homepageId ?? null,
        description: space.description ?? null,
      }
    }),
    nextCursor: nextCursor(data),
  }
}

export async function executeConfluenceSpaceProperties(
  input: ConfluenceSpacePropertiesBody,
  context: ConfluenceOperationContext
) {
  assertId(input.spaceId, 'spaceId')
  const client = await createConfluenceClient(input, context.signal)
  const base = client.apiV2(`/spaces/${input.spaceId}/properties`)
  if (input.action === 'delete') {
    if (!input.propertyId) {
      throw new ConfluenceOperationError('Property ID is required for delete action', 400)
    }
    assertId(input.propertyId, 'propertyId')
    await client.delete(`${base}/${encodeURIComponent(input.propertyId)}`, context.signal)
    return { spaceId: input.spaceId, propertyId: input.propertyId, deleted: true }
  }
  if (input.action === 'create') {
    if (!input.key) {
      throw new ConfluenceOperationError('Property key is required for create action', 400)
    }
    const data = await client.json(
      base,
      jsonInit('POST', { key: input.key, value: input.value ?? {} }),
      context.signal
    )
    return { propertyId: data.id, key: data.key, value: data.value ?? null, spaceId: input.spaceId }
  }
  assertCursor(input.cursor)
  const query = new URLSearchParams({ limit: cappedLimit(input.limit) })
  if (input.cursor) query.set('cursor', input.cursor)
  const data = await client.json(`${base}?${query}`, {}, context.signal)
  return {
    properties: asArray(data.results).map((value) => {
      const property = asObject(value)
      return { id: property.id, key: property.key, value: property.value ?? null }
    }),
    spaceId: input.spaceId,
    nextCursor: nextCursor(data),
  }
}

function mapTask(value: unknown): JsonObject {
  const task = asObject(value)
  return {
    id: task.id,
    localId: task.localId ?? null,
    spaceId: task.spaceId ?? null,
    pageId: task.pageId ?? null,
    blogPostId: task.blogPostId ?? null,
    status: task.status,
    body: nested(task, 'body', 'storage', 'value') ?? null,
    createdBy: task.createdBy ?? null,
    assignedTo: task.assignedTo ?? null,
    completedBy: task.completedBy ?? null,
    createdAt: task.createdAt ?? null,
    updatedAt: task.updatedAt ?? null,
    dueAt: task.dueAt ?? null,
    completedAt: task.completedAt ?? null,
  }
}

export async function executeConfluenceTasks(
  input: ConfluenceTasksBody,
  context: ConfluenceOperationContext
) {
  const client = await createConfluenceClient(input, context.signal)
  if (input.action === 'update' && input.taskId) {
    assertId(input.taskId, 'taskId')
    const url = client.apiV2(`/tasks/${input.taskId}`)
    const current = await client.json(url, {}, context.signal)
    const data = await client.json(
      url,
      jsonInit('PUT', { id: input.taskId, status: input.status || current.status }),
      context.signal
    )
    return { task: mapTask(data) }
  }
  if (input.taskId) {
    assertId(input.taskId, 'taskId')
    const data = await client.json(client.apiV2(`/tasks/${input.taskId}`), {}, context.signal)
    return { task: mapTask(data) }
  }
  assertCursor(input.cursor)
  const query = new URLSearchParams({ limit: cappedLimit(input.limit) })
  if (input.cursor) query.set('cursor', input.cursor)
  if (input.status) query.set('status', input.status)
  if (input.pageId) {
    assertId(input.pageId, 'pageId')
    query.set('page-id', input.pageId)
  }
  if (input.spaceId) {
    assertId(input.spaceId, 'spaceId')
    query.set('space-id', input.spaceId)
  }
  if (input.assignedTo) {
    const validation = validatePathSegment(input.assignedTo, {
      paramName: 'assignedTo',
      maxLength: 128,
      customPattern: /^[a-zA-Z0-9_|:-]+$/,
    })
    if (!validation.isValid) {
      throw new ConfluenceOperationError(validation.error || 'Invalid assignedTo', 400)
    }
    query.set('assigned-to', input.assignedTo)
  }
  const data = await client.json(client.apiV2(`/tasks?${query}`), {}, context.signal)
  return { tasks: asArray(data.results).map(mapTask), nextCursor: nextCursor(data) }
}

export async function executeConfluenceGetUser(
  input: ConfluenceUserBody,
  context: ConfluenceOperationContext
) {
  const validation = validatePathSegment(input.accountId, {
    paramName: 'accountId',
    maxLength: 128,
    customPattern: /^[a-zA-Z0-9_|:-]+$/,
  })
  if (!validation.isValid) {
    throw new ConfluenceOperationError(validation.error || 'Invalid accountId', 400)
  }
  const client = await createConfluenceClient(input, context.signal)
  return client.json(
    client.rest(`/user?accountId=${encodeURIComponent(input.accountId)}`),
    {},
    context.signal
  )
}
