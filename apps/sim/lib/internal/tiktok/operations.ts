import { createLogger } from '@sim/logger'
import { getErrorMessage } from '@sim/utils/errors'
import { isPayloadSizeLimitError } from '@/lib/core/utils/stream-limits'
import type { TikTokUploadVideoDraftInput } from '@/lib/internal/tiktok/schema'
import {
  computeTikTokChunkPlan,
  getStoredVideoSize,
  streamStoredVideoToTikTok,
  TIKTOK_MAX_VIDEO_BYTES,
} from '@/lib/internal/tiktok/upload'
import {
  getFileExtension,
  getMimeTypeFromExtension,
  processSingleFileToUserFile,
  resolveTrustedFileContext,
} from '@/lib/uploads/utils/file-utils'
import { assertToolFileAccess } from '@/app/api/files/authorization'
import { tiktokPublishInitApiDataSchema } from '@/tools/tiktok/api-schemas'
import { readTikTokApiResponse } from '@/tools/tiktok/utils'

const logger = createLogger('TikTokUploadVideoDraft')
const TIKTOK_VIDEO_MIME_TYPES = new Set(['video/mp4', 'video/quicktime', 'video/webm'])

export interface TikTokOperationContext {
  userId: string
  requestId: string
  signal?: AbortSignal
}

function failureResponse(error: string, status: number): Response {
  return Response.json({ success: false, error }, { status })
}

function resolveVideoMimeType(fileName: string, fileType: string | undefined): string | null {
  if (fileType && TIKTOK_VIDEO_MIME_TYPES.has(fileType)) return fileType
  const fromExtension = getMimeTypeFromExtension(getFileExtension(fileName))
  return TIKTOK_VIDEO_MIME_TYPES.has(fromExtension) ? fromExtension : null
}

export async function executeTikTokUploadVideoDraft(
  input: TikTokUploadVideoDraftInput,
  context: TikTokOperationContext
): Promise<Response> {
  const signal = context.signal ?? new AbortController().signal
  try {
    signal.throwIfAborted()
    let userFile
    try {
      userFile = processSingleFileToUserFile(input.file, context.requestId, logger)
    } catch (error) {
      return failureResponse(getErrorMessage(error, 'Failed to process file'), 400)
    }

    const denied = await assertToolFileAccess(
      userFile.key,
      context.userId,
      context.requestId,
      logger
    )
    signal.throwIfAborted()
    if (denied) return denied

    const mimeType = resolveVideoMimeType(userFile.name, userFile.type)
    if (!mimeType) {
      return failureResponse(
        'Unsupported video type. TikTok accepts MP4, MOV/QuickTime, or WebM files.',
        400
      )
    }

    const storageContext = resolveTrustedFileContext(userFile.key, userFile.context)
    const videoSize = await getStoredVideoSize({
      key: userFile.key,
      context: storageContext,
      signal,
    })
    if (videoSize === 0) return failureResponse('The video file is empty.', 400)

    const { chunkSize, totalChunkCount } = computeTikTokChunkPlan(videoSize)
    const initResponse = await fetch(
      'https://open.tiktokapis.com/v2/post/publish/inbox/video/init/',
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${input.accessToken}`,
          'Content-Type': 'application/json; charset=UTF-8',
        },
        body: JSON.stringify({
          source_info: {
            source: 'FILE_UPLOAD',
            video_size: videoSize,
            chunk_size: chunkSize,
            total_chunk_count: totalChunkCount,
          },
        }),
        signal,
      }
    )
    const { data: initData, error: initError } = await readTikTokApiResponse(
      initResponse,
      tiktokPublishInitApiDataSchema,
      { signal }
    )
    if (initError) {
      return failureResponse(
        initError.message || initError.code || 'Failed to initialize TikTok upload',
        initResponse.status >= 400 ? initResponse.status : 502
      )
    }

    const publishId = initData?.publish_id
    const uploadUrl = initData?.upload_url
    if (!publishId || !uploadUrl) {
      return failureResponse('TikTok did not return a publish ID and upload URL', 502)
    }

    try {
      await streamStoredVideoToTikTok({
        key: userFile.key,
        context: storageContext,
        uploadUrl,
        totalBytes: videoSize,
        mimeType,
        requestId: context.requestId,
        signal,
      })
    } catch (error) {
      if (signal.aborted) throw error
      return failureResponse(getErrorMessage(error, 'Failed to upload video to TikTok'), 502)
    }

    return Response.json({ success: true, output: { publishId } })
  } catch (error) {
    if (isPayloadSizeLimitError(error)) {
      const maxMb = Math.floor(TIKTOK_MAX_VIDEO_BYTES / (1024 * 1024))
      return failureResponse(`Video exceeds the ${maxMb}MB limit for file uploads.`, 413)
    }
    if (signal.aborted) return failureResponse('TikTok video upload was cancelled.', 499)
    logger.error(`[${context.requestId}] TikTok video draft upload failed`, {
      error: getErrorMessage(error),
    })
    return failureResponse(getErrorMessage(error, 'Internal server error'), 500)
  }
}
