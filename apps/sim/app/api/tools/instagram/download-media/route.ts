import { createLogger } from '@sim/logger'
import { getErrorMessage } from '@sim/utils/errors'
import { isRecordLike } from '@sim/utils/object'
import { type NextRequest, NextResponse } from 'next/server'
import {
  type InstagramDownloadMediaRouteResponse,
  instagramDownloadMediaContract,
  instagramDownloadMediaOutputSchema,
} from '@/lib/api/contracts/tools/instagram'
import { getValidationErrorMessage, parseRequest } from '@/lib/api/server'
import { checkInternalAuth } from '@/lib/auth/hybrid'
import { isPayloadSizeLimitError, readResponseJsonWithLimit } from '@/lib/core/utils/stream-limits'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'
import { uploadCopilotFile } from '@/lib/uploads/contexts/copilot'
import { uploadExecutionFile } from '@/lib/uploads/contexts/execution'
import { deleteFiles } from '@/lib/uploads/core/storage-service'
import { deleteFileMetadata } from '@/lib/uploads/server/metadata'
import type { StorageContext } from '@/lib/uploads/shared/types'
import {
  getExtensionFromMimeType,
  getFileExtension,
  getMimeTypeFromExtension,
} from '@/lib/uploads/utils/file-utils'
import { downloadFileFromUrl } from '@/lib/uploads/utils/file-utils.server'
import { MAX_FILE_SIZE, sniffImageContentType } from '@/lib/uploads/utils/validation'
import { sanitizeFileName } from '@/executor/constants'
import type { UserFile } from '@/executor/types'
import { bearerHeaders, graphUrl, idString, readGraphError } from '@/tools/instagram/utils'

const logger = createLogger('InstagramDownloadMediaAPI')
const MAX_GRAPH_METADATA_BYTES = 256 * 1024
const MAX_CAROUSEL_ITEMS = 10
const ROOT_MEDIA_FIELDS = 'id,media_type,media_url,children{id}'
const CHILD_MEDIA_FIELDS = 'id,media_type,media_url'

export const dynamic = 'force-dynamic'
export const maxDuration = 900

interface InstagramMediaMetadata {
  id: string
  mediaType: string | null
  mediaUrl: string | null
  childIds: string[]
}

type InstagramMediaMetadataResult =
  | { success: true; data: InstagramMediaMetadata }
  | { success: false; error: string; status: number }

function failureResponse(error: string, status: number) {
  const body = { success: false, error } satisfies InstagramDownloadMediaRouteResponse
  return NextResponse.json(body, { status })
}

function normalizedId(value: unknown): string | null {
  return typeof value === 'string' || typeof value === 'number' ? idString(value) : null
}

function parseMediaMetadata(data: unknown): InstagramMediaMetadataResult {
  if (!isRecordLike(data)) {
    return { success: false, error: 'Instagram returned invalid media metadata', status: 502 }
  }

  const id = normalizedId(data.id)
  if (!id) {
    return { success: false, error: 'Instagram media metadata did not include an ID', status: 502 }
  }

  const mediaType = typeof data.media_type === 'string' ? data.media_type : null
  const mediaUrl =
    typeof data.media_url === 'string' && data.media_url.length > 0 ? data.media_url : null
  const children = data.children

  if (children === undefined) {
    return { success: true, data: { id, mediaType, mediaUrl, childIds: [] } }
  }

  if (!isRecordLike(children) || !Array.isArray(children.data)) {
    return { success: false, error: 'Instagram returned invalid carousel metadata', status: 502 }
  }

  if (children.data.length > MAX_CAROUSEL_ITEMS) {
    return {
      success: false,
      error: `Instagram carousel exceeds the ${MAX_CAROUSEL_ITEMS}-item download limit`,
      status: 502,
    }
  }

  const childIds: string[] = []
  for (const child of children.data) {
    if (!isRecordLike(child)) {
      return { success: false, error: 'Instagram returned an invalid carousel item', status: 502 }
    }
    const childId = normalizedId(child.id)
    if (!childId) {
      return {
        success: false,
        error: 'Instagram carousel item did not include an ID',
        status: 502,
      }
    }
    childIds.push(childId)
  }

  return { success: true, data: { id, mediaType, mediaUrl, childIds } }
}

async function fetchMediaMetadata({
  accessToken,
  mediaId,
  fields,
  signal,
}: {
  accessToken: string
  mediaId: string
  fields: string
  signal: AbortSignal
}): Promise<InstagramMediaMetadataResult> {
  const response = await fetch(graphUrl(`/${encodeURIComponent(mediaId)}`, { fields }), {
    headers: bearerHeaders(accessToken),
    signal,
  })

  if (!response.ok) {
    return {
      success: false,
      error: await readGraphError(response),
      status: response.status >= 400 && response.status < 500 ? response.status : 502,
    }
  }

  const data = await readResponseJsonWithLimit<unknown>(response, {
    maxBytes: MAX_GRAPH_METADATA_BYTES,
    label: `Instagram media ${mediaId} metadata`,
    signal,
  })
  return parseMediaMetadata(data)
}

function inferContentType(mediaUrl: string, mediaType: string | null): string {
  if (mediaType === 'VIDEO') return 'video/mp4'
  if (mediaType === 'IMAGE') return 'image/jpeg'

  let extension = ''
  try {
    extension = getFileExtension(new URL(mediaUrl).pathname)
  } catch {
    extension = ''
  }

  const mimeType = getMimeTypeFromExtension(extension)
  if (mimeType !== 'application/octet-stream') return mimeType
  return 'application/octet-stream'
}

function resolveDownloadedContentType(
  buffer: Buffer,
  mediaUrl: string,
  mediaType: string | null
): string {
  const inferred = inferContentType(mediaUrl, mediaType)
  if (mediaType === 'IMAGE' || inferred.startsWith('image/')) {
    return sniffImageContentType(buffer) ?? 'application/octet-stream'
  }
  return inferred
}

function buildFilename({
  filename,
  mediaId,
  contentType,
  itemIndex,
  itemCount,
}: {
  filename?: string
  mediaId: string
  contentType: string
  itemIndex: number
  itemCount: number
}): string {
  const extension = getExtensionFromMimeType(contentType) ?? 'bin'
  if (!filename) return sanitizeFileName(`instagram-${mediaId}.${extension}`)

  const sanitized = sanitizeFileName(filename).replace(/^\.+/, '')
  const lastDot = sanitized.lastIndexOf('.')
  const base = (lastDot > 0 ? sanitized.slice(0, lastDot) : sanitized) || `instagram-${mediaId}`
  const suffix = itemCount > 1 ? `-${itemIndex + 1}` : ''
  return `${base}${suffix}.${extension}`
}

async function downloadAndStoreMedia({
  metadata,
  filename,
  itemIndex,
  itemCount,
  userId,
  executionContext,
  signal,
}: {
  metadata: InstagramMediaMetadata
  filename?: string
  itemIndex: number
  itemCount: number
  userId: string
  executionContext?: { workspaceId: string; workflowId: string; executionId: string }
  signal: AbortSignal
}): Promise<UserFile> {
  if (!metadata.mediaUrl) {
    throw new Error(`Instagram media ${metadata.id} did not include a downloadable URL`)
  }

  const buffer = await downloadFileFromUrl(metadata.mediaUrl, {
    maxBytes: MAX_FILE_SIZE,
    signal,
    userId,
  })
  const contentType = resolveDownloadedContentType(buffer, metadata.mediaUrl, metadata.mediaType)
  const storedFilename = buildFilename({
    filename,
    mediaId: metadata.id,
    contentType,
    itemIndex,
    itemCount,
  })
  if (executionContext) {
    return uploadExecutionFile(executionContext, buffer, storedFilename, contentType, userId)
  }

  return uploadCopilotFile({
    buffer,
    fileName: storedFilename,
    contentType,
    userId,
  })
}

/** Removes successfully stored files when a multi-item download cannot return a complete result. */
async function rollbackStoredFiles(files: UserFile[], context: StorageContext): Promise<void> {
  if (files.length === 0) return

  const keys = files.map((file) => file.key)
  let failedKeys: Set<string>
  try {
    const deletion = await deleteFiles(keys, context)
    failedKeys = new Set(deletion.failed.map((failure) => failure.key))
    if (deletion.failed.length > 0) {
      logger.warn('Instagram media rollback could not delete every stored object', {
        context,
        failedKeys: [...failedKeys],
      })
    }
  } catch (error) {
    logger.warn('Instagram media rollback failed before metadata cleanup', {
      context,
      error: getErrorMessage(error),
      keys,
    })
    return
  }

  for (const key of keys) {
    if (failedKeys.has(key)) continue
    try {
      await deleteFileMetadata(key)
    } catch (error) {
      logger.warn('Instagram media rollback could not delete file metadata', {
        error: getErrorMessage(error),
        key,
      })
    }
  }
}

export const POST = withRouteHandler(async (request: NextRequest) => {
  const authResult = await checkInternalAuth(request, { requireWorkflowId: false })
  if (!authResult.success || !authResult.userId) {
    return failureResponse(authResult.error || 'Unauthorized', 401)
  }

  const parsed = await parseRequest(
    instagramDownloadMediaContract,
    request,
    {},
    {
      validationErrorResponse: (error) =>
        failureResponse(getValidationErrorMessage(error, 'Invalid request data'), 400),
    }
  )
  if (!parsed.success) return parsed.response

  const files: UserFile[] = []
  let storageContext: StorageContext = 'copilot'
  try {
    const body = parsed.data.body
    const rootResult = await fetchMediaMetadata({
      accessToken: body.accessToken,
      mediaId: body.mediaId,
      fields: ROOT_MEDIA_FIELDS,
      signal: request.signal,
    })
    if (!rootResult.success) return failureResponse(rootResult.error, rootResult.status)

    const rootMedia = rootResult.data
    const itemCount = rootMedia.childIds.length || 1
    const executionContext =
      body.workspaceId && body.workflowId && body.executionId
        ? {
            workspaceId: body.workspaceId,
            workflowId: body.workflowId,
            executionId: body.executionId,
          }
        : undefined
    storageContext = executionContext ? 'execution' : 'copilot'

    if (rootMedia.childIds.length === 0) {
      files.push(
        await downloadAndStoreMedia({
          metadata: rootMedia,
          filename: body.filename,
          itemIndex: 0,
          itemCount,
          userId: authResult.userId,
          executionContext,
          signal: request.signal,
        })
      )
    } else {
      for (const [itemIndex, childId] of rootMedia.childIds.entries()) {
        const childResult = await fetchMediaMetadata({
          accessToken: body.accessToken,
          mediaId: childId,
          fields: CHILD_MEDIA_FIELDS,
          signal: request.signal,
        })
        if (!childResult.success) {
          await rollbackStoredFiles(files, storageContext)
          return failureResponse(childResult.error, childResult.status)
        }

        files.push(
          await downloadAndStoreMedia({
            metadata: childResult.data,
            filename: body.filename,
            itemIndex,
            itemCount,
            userId: authResult.userId,
            executionContext,
            signal: request.signal,
          })
        )
      }
    }

    const output = instagramDownloadMediaOutputSchema.parse({
      files,
      mediaId: rootMedia.id,
      mediaType: rootMedia.mediaType,
      downloadedCount: files.length,
    })
    const responseBody = {
      success: true,
      output,
    } satisfies InstagramDownloadMediaRouteResponse

    return NextResponse.json(responseBody)
  } catch (error) {
    await rollbackStoredFiles(files, storageContext)
    logger.error('Instagram media download failed', { error })
    return failureResponse(
      getErrorMessage(error, 'Failed to download Instagram media'),
      isPayloadSizeLimitError(error) ? 413 : 500
    )
  }
})
