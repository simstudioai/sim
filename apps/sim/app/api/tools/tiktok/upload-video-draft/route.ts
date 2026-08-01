import { createLogger } from '@sim/logger'
import { getErrorMessage } from '@sim/utils/errors'
import { type NextRequest, NextResponse } from 'next/server'
import { tiktokUploadVideoDraftContract } from '@/lib/api/contracts/tiktok-tools'
import { parseRequest } from '@/lib/api/server'
import { checkInternalAuth } from '@/lib/auth/hybrid'
import { generateRequestId } from '@/lib/core/utils/request'
import { isPayloadSizeLimitError } from '@/lib/core/utils/stream-limits'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'
import {
  getFileExtension,
  getMimeTypeFromExtension,
  processSingleFileToUserFile,
  resolveTrustedFileContext,
} from '@/lib/uploads/utils/file-utils'
import { assertToolFileAccess } from '@/app/api/files/authorization'
import {
  computeTikTokChunkPlan,
  getStoredVideoSize,
  streamStoredVideoToTikTok,
  TIKTOK_MAX_VIDEO_BYTES,
} from '@/app/api/tools/tiktok/upload-video-draft/upload'
import type { UserFile } from '@/executor/types'
import { tiktokPublishInitApiDataSchema } from '@/tools/tiktok/api-schemas'
import { readTikTokApiResponse } from '@/tools/tiktok/utils'

export const dynamic = 'force-dynamic'
export const maxDuration = 900

const logger = createLogger('TikTokUploadVideoDraftAPI')

const TIKTOK_VIDEO_MIME_TYPES = new Set(['video/mp4', 'video/quicktime', 'video/webm'])

function resolveVideoMimeType(fileName: string, fileType: string | undefined): string | null {
  if (fileType && TIKTOK_VIDEO_MIME_TYPES.has(fileType)) return fileType
  const fromExtension = getMimeTypeFromExtension(getFileExtension(fileName))
  return TIKTOK_VIDEO_MIME_TYPES.has(fromExtension) ? fromExtension : null
}

export const POST = withRouteHandler(async (request: NextRequest) => {
  const requestId = generateRequestId()

  try {
    const authResult = await checkInternalAuth(request, { requireWorkflowId: false })
    if (!authResult.success || !authResult.userId) {
      logger.warn(
        `[${requestId}] Unauthorized TikTok upload-video-draft attempt: ${authResult.error}`
      )
      return NextResponse.json(
        { success: false, error: authResult.error || 'Authentication required' },
        { status: 401 }
      )
    }

    const parsed = await parseRequest(tiktokUploadVideoDraftContract, request, {})
    if (!parsed.success) return parsed.response
    const data = parsed.data.body

    let userFile: UserFile
    try {
      userFile = processSingleFileToUserFile(data.file, requestId, logger)
    } catch (error) {
      return NextResponse.json(
        { success: false, error: getErrorMessage(error, 'Failed to process file') },
        { status: 400 }
      )
    }

    const denied = await assertToolFileAccess(userFile.key, authResult.userId, requestId, logger)
    if (denied) return denied

    const mimeType = resolveVideoMimeType(userFile.name, userFile.type)
    if (!mimeType) {
      return NextResponse.json(
        {
          success: false,
          error: 'Unsupported video type. TikTok accepts MP4, MOV/QuickTime, or WebM files.',
        },
        { status: 400 }
      )
    }

    const context = resolveTrustedFileContext(userFile.key, userFile.context)
    const videoSize = await getStoredVideoSize({
      key: userFile.key,
      context,
      signal: request.signal,
    })
    if (videoSize === 0) {
      return NextResponse.json(
        { success: false, error: 'The video file is empty.' },
        { status: 400 }
      )
    }

    logger.info(`[${requestId}] Resolved video from storage`, {
      fileName: userFile.name,
      declaredSize: userFile.size,
      storageSize: videoSize,
    })

    const { chunkSize, totalChunkCount } = computeTikTokChunkPlan(videoSize)
    const initBody = {
      source_info: {
        source: 'FILE_UPLOAD',
        video_size: videoSize,
        chunk_size: chunkSize,
        total_chunk_count: totalChunkCount,
      },
    }

    logger.info(`[${requestId}] Initializing TikTok video draft`, {
      videoSize,
      chunkSize,
      totalChunkCount,
    })

    const initResponse = await fetch(
      'https://open.tiktokapis.com/v2/post/publish/inbox/video/init/',
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${data.accessToken}`,
          'Content-Type': 'application/json; charset=UTF-8',
        },
        body: JSON.stringify(initBody),
        signal: request.signal,
      }
    )

    const { data: initData, error: initError } = await readTikTokApiResponse(
      initResponse,
      tiktokPublishInitApiDataSchema,
      { signal: request.signal }
    )

    if (initError) {
      logger.error(`[${requestId}] TikTok init failed`, { error: initError })
      return NextResponse.json(
        {
          success: false,
          error: initError.message || initError.code || 'Failed to initialize TikTok upload',
        },
        { status: initResponse.status >= 400 ? initResponse.status : 502 }
      )
    }

    const publishId = initData?.publish_id
    const uploadUrl = initData?.upload_url

    if (!publishId || !uploadUrl) {
      return NextResponse.json(
        { success: false, error: 'TikTok did not return a publish ID and upload URL' },
        { status: 502 }
      )
    }

    try {
      await streamStoredVideoToTikTok({
        key: userFile.key,
        context,
        uploadUrl,
        totalBytes: videoSize,
        mimeType,
        requestId,
        signal: request.signal,
      })
    } catch (error) {
      if (request.signal.aborted) throw error
      return NextResponse.json(
        { success: false, error: getErrorMessage(error, 'Failed to upload video to TikTok') },
        { status: 502 }
      )
    }

    logger.info(`[${requestId}] TikTok video upload complete`, { publishId })

    return NextResponse.json({ success: true, output: { publishId } })
  } catch (error) {
    if (isPayloadSizeLimitError(error)) {
      logger.warn(`[${requestId}] Rejected oversized TikTok video upload`, {
        maxBytes: error.maxBytes,
        observedBytes: error.observedBytes,
      })
      const maxMb = Math.floor(TIKTOK_MAX_VIDEO_BYTES / (1024 * 1024))
      return NextResponse.json(
        {
          success: false,
          error: `Video exceeds the ${maxMb}MB limit for file uploads.`,
        },
        { status: 413 }
      )
    }
    if (request.signal.aborted) {
      return NextResponse.json(
        { success: false, error: 'TikTok video upload was cancelled.' },
        { status: 499 }
      )
    }
    logger.error(`[${requestId}] Error uploading TikTok video draft:`, error)
    return NextResponse.json(
      { success: false, error: getErrorMessage(error, 'Internal server error') },
      { status: 500 }
    )
  }
})
