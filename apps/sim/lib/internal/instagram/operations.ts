import { createLogger } from '@sim/logger'
import { getErrorMessage } from '@sim/utils/errors'
import { isRecordLike } from '@sim/utils/object'
import { isPayloadSizeLimitError, readResponseJsonWithLimit } from '@/lib/core/utils/stream-limits'
import {
  createMediaContainer,
  publishMediaContainer,
  resolveIgUserId,
  resolveInstagramCarouselMedia,
  resolveInstagramMedia,
  waitForContainerReady,
} from '@/lib/internal/instagram/publishing'
import {
  type InstagramDownloadMediaBody,
  type InstagramDownloadMediaRouteResponse,
  type InstagramPublishCarouselBody,
  type InstagramPublishImageBody,
  type InstagramPublishReelBody,
  type InstagramPublishStoryBody,
  type InstagramPublishVideoBody,
  instagramDownloadMediaOutputSchema,
} from '@/lib/internal/instagram/schema'
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

const logger = createLogger('InstagramOperations')
const MAX_GRAPH_METADATA_BYTES = 256 * 1024
const MAX_CAROUSEL_ITEMS = 10
const ROOT_MEDIA_FIELDS = 'id,media_type,media_url,children{id}'
const CHILD_MEDIA_FIELDS = 'id,media_type,media_url'

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
  return Response.json(body, { status })
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
  signal?: AbortSignal
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
  signal?: AbortSignal
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

export interface InstagramOperationContext {
  userId: string
  workspaceId?: string
  workflowId?: string
  executionId?: string
  requestId: string
  signal?: AbortSignal
}

export async function executeInstagramDownloadMedia(
  body: InstagramDownloadMediaBody,
  context: InstagramOperationContext
): Promise<Response> {
  const { executionId, requestId, signal, userId, workflowId, workspaceId } = context
  signal?.throwIfAborted()
  const files: UserFile[] = []
  let storageContext: StorageContext = 'copilot'
  try {
    const rootResult = await fetchMediaMetadata({
      accessToken: body.accessToken,
      mediaId: body.mediaId,
      fields: ROOT_MEDIA_FIELDS,
      signal,
    })
    if (!rootResult.success) return failureResponse(rootResult.error, rootResult.status)

    const rootMedia = rootResult.data
    const itemCount = rootMedia.childIds.length || 1
    const executionContext =
      workspaceId && workflowId && executionId
        ? {
            workspaceId,
            workflowId,
            executionId,
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
          userId,
          executionContext,
          signal,
        })
      )
    } else {
      for (const [itemIndex, childId] of rootMedia.childIds.entries()) {
        const childResult = await fetchMediaMetadata({
          accessToken: body.accessToken,
          mediaId: childId,
          fields: CHILD_MEDIA_FIELDS,
          signal,
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
            userId,
            executionContext,
            signal,
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

    return Response.json(responseBody)
  } catch (error) {
    await rollbackStoredFiles(files, storageContext)
    signal?.throwIfAborted()
    logger.error('Instagram media download failed', { error })

    if (isPayloadSizeLimitError(error) && error.maxBytes === MAX_FILE_SIZE) {
      return failureResponse('Instagram media exceeds the 100 MB canonical User File limit', 413)
    }

    return failureResponse(
      getErrorMessage(error, 'Failed to download Instagram media'),
      isPayloadSizeLimitError(error) ? 413 : 500
    )
  }
}

const FAILED_PUBLISH_OUTPUT = {
  containerId: null,
  mediaId: null,
  statusCode: null,
} as const

function publishFailure(error: string, status: number): Response {
  return Response.json({ success: false, error, output: FAILED_PUBLISH_OUTPUT }, { status })
}

async function publishContainer(
  accessToken: string,
  igUserIdOverride: string | null | undefined,
  containerBody: Record<string, unknown>,
  context: InstagramOperationContext
): Promise<Response> {
  context.signal?.throwIfAborted()
  const igUserId = await resolveIgUserId(accessToken, igUserIdOverride ?? undefined, context.signal)
  const containerId = await createMediaContainer(
    accessToken,
    igUserId,
    containerBody,
    context.signal
  )
  const { statusCode } = await waitForContainerReady(accessToken, containerId, context.signal)
  const mediaId = await publishMediaContainer(accessToken, igUserId, containerId, context.signal)
  return Response.json({
    success: true,
    output: { containerId, mediaId, statusCode },
  })
}

export async function executeInstagramPublishImage(
  body: InstagramPublishImageBody,
  context: InstagramOperationContext
): Promise<Response> {
  try {
    const resolved = await resolveInstagramMedia({
      input: body.image,
      userId: context.userId,
      requestId: context.requestId,
      logger,
      role: 'image',
      label: 'Image',
    })
    if (resolved.error || !resolved.media) {
      return publishFailure(
        resolved.error?.message || 'Failed to resolve image',
        resolved.error?.status || 400
      )
    }

    const containerBody: Record<string, unknown> = { image_url: resolved.media.url }
    if (body.caption) containerBody.caption = body.caption
    if (body.altText) containerBody.alt_text = body.altText
    if (body.isAiGenerated === true) containerBody.is_ai_generated = true
    return await publishContainer(body.accessToken, body.igUserId, containerBody, context)
  } catch (error) {
    context.signal?.throwIfAborted()
    logger.error('Instagram publish image failed', { error })
    return publishFailure(getErrorMessage(error, 'Failed to publish image'), 500)
  }
}

async function resolveOptionalCover(
  cover: InstagramPublishVideoBody['cover'],
  context: InstagramOperationContext
): Promise<{ url?: string; response?: Response }> {
  if (cover == null) return {}
  const resolved = await resolveInstagramMedia({
    input: cover,
    userId: context.userId,
    requestId: context.requestId,
    logger,
    role: 'cover',
    required: false,
    label: 'Cover image',
  })
  if (resolved.error) {
    return { response: publishFailure(resolved.error.message, resolved.error.status) }
  }
  return { url: resolved.media?.url }
}

async function executeInstagramPublishVideoLike(
  body: InstagramPublishVideoBody | InstagramPublishReelBody,
  context: InstagramOperationContext,
  mode: 'video' | 'reel'
): Promise<Response> {
  try {
    const resolvedVideo = await resolveInstagramMedia({
      input: body.video,
      userId: context.userId,
      requestId: context.requestId,
      logger,
      role: 'video',
      label: 'Video',
    })
    if (resolvedVideo.error || !resolvedVideo.media) {
      return publishFailure(
        resolvedVideo.error?.message || 'Failed to resolve video',
        resolvedVideo.error?.status || 400
      )
    }

    const cover = await resolveOptionalCover(body.cover, context)
    if (cover.response) return cover.response

    const containerBody: Record<string, unknown> = {
      media_type: 'REELS',
      video_url: resolvedVideo.media.url,
    }
    if (mode === 'video') containerBody.share_to_feed = true
    if (body.caption) containerBody.caption = body.caption
    if (cover.url) containerBody.cover_url = cover.url
    if (mode === 'reel') {
      const reel = body as InstagramPublishReelBody
      if (reel.shareToFeed !== undefined && reel.shareToFeed !== null) {
        containerBody.share_to_feed = reel.shareToFeed
      }
      if (reel.thumbOffset != null) containerBody.thumb_offset = reel.thumbOffset
    }
    return await publishContainer(body.accessToken, body.igUserId, containerBody, context)
  } catch (error) {
    context.signal?.throwIfAborted()
    const action = mode === 'video' ? 'video' : 'reel'
    logger.error(`Instagram publish ${action} failed`, { error })
    return publishFailure(getErrorMessage(error, `Failed to publish ${action}`), 500)
  }
}

export function executeInstagramPublishVideo(
  body: InstagramPublishVideoBody,
  context: InstagramOperationContext
): Promise<Response> {
  return executeInstagramPublishVideoLike(body, context, 'video')
}

export function executeInstagramPublishReel(
  body: InstagramPublishReelBody,
  context: InstagramOperationContext
): Promise<Response> {
  return executeInstagramPublishVideoLike(body, context, 'reel')
}

export async function executeInstagramPublishStory(
  body: InstagramPublishStoryBody,
  context: InstagramOperationContext
): Promise<Response> {
  try {
    const resolved = await resolveInstagramMedia({
      input: body.media,
      userId: context.userId,
      requestId: context.requestId,
      logger,
      role: 'story',
      label: 'Story media',
    })
    if (resolved.error || !resolved.media) {
      return publishFailure(
        resolved.error?.message || 'Failed to resolve story media',
        resolved.error?.status || 400
      )
    }

    const containerBody: Record<string, unknown> = { media_type: 'STORIES' }
    if (resolved.media.kind === 'video') containerBody.video_url = resolved.media.url
    else containerBody.image_url = resolved.media.url
    return await publishContainer(body.accessToken, body.igUserId, containerBody, context)
  } catch (error) {
    context.signal?.throwIfAborted()
    logger.error('Instagram publish story failed', { error })
    return publishFailure(getErrorMessage(error, 'Failed to publish story'), 500)
  }
}

export async function executeInstagramPublishCarousel(
  body: InstagramPublishCarouselBody,
  context: InstagramOperationContext
): Promise<Response> {
  try {
    const resolved = await resolveInstagramCarouselMedia(
      body.media,
      context.userId,
      context.requestId,
      logger
    )
    if (resolved.error || !resolved.items) {
      return publishFailure(
        resolved.error?.message || 'Failed to resolve carousel media',
        resolved.error?.status || 400
      )
    }

    const igUserId = await resolveIgUserId(
      body.accessToken,
      body.igUserId ?? undefined,
      context.signal
    )
    const childIds: string[] = []
    for (const item of resolved.items) {
      context.signal?.throwIfAborted()
      const childBody: Record<string, unknown> = { is_carousel_item: true }
      if (item.kind === 'video') {
        childBody.media_type = 'VIDEO'
        childBody.video_url = item.url
      } else {
        childBody.image_url = item.url
      }
      childIds.push(
        await createMediaContainer(body.accessToken, igUserId, childBody, context.signal)
      )
    }

    const childResults = await Promise.allSettled(
      childIds.map((childId) => waitForContainerReady(body.accessToken, childId, context.signal))
    )
    const failedChild = childResults.find(
      (result): result is PromiseRejectedResult => result.status === 'rejected'
    )
    if (failedChild) throw failedChild.reason

    const parentBody: Record<string, unknown> = {
      media_type: 'CAROUSEL',
      children: childIds.join(','),
    }
    if (body.caption) parentBody.caption = body.caption
    return await publishContainer(body.accessToken, igUserId, parentBody, {
      ...context,
      signal: context.signal,
    })
  } catch (error) {
    context.signal?.throwIfAborted()
    logger.error('Instagram publish carousel failed', { error })
    return publishFailure(getErrorMessage(error, 'Failed to publish carousel'), 500)
  }
}
