import { createLogger } from '@sim/logger'
import { getErrorMessage } from '@sim/utils/errors'
import { type NextRequest, NextResponse } from 'next/server'
import { tiktokPublishVideoContract } from '@/lib/api/contracts/tiktok-tools'
import { parseRequest } from '@/lib/api/server'
import { checkInternalAuth } from '@/lib/auth/hybrid'
import { generateRequestId } from '@/lib/core/utils/request'
import { isPayloadSizeLimitError, readResponseTextWithLimit } from '@/lib/core/utils/stream-limits'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'
import {
  getFileExtension,
  getMimeTypeFromExtension,
  processSingleFileToUserFile,
} from '@/lib/uploads/utils/file-utils'
import { downloadFileFromStorage } from '@/lib/uploads/utils/file-utils.server'
import { assertToolFileAccess } from '@/app/api/files/authorization'
import type { UserFile } from '@/executor/types'
import { tiktokPublishInitApiDataSchema } from '@/tools/tiktok/api-schemas'
import { readTikTokApiResponse } from '@/tools/tiktok/utils'

export const dynamic = 'force-dynamic'

const logger = createLogger('TikTokPublishVideoAPI')

const TIKTOK_VIDEO_MIME_TYPES = new Set(['video/mp4', 'video/quicktime', 'video/webm'])

/** TikTok requires each chunk between 5MB and 64MB; the final chunk absorbs the remainder (up to ~2x this size, well under the 128MB cap). Capped at 1000 chunks total, which this default comfortably satisfies up to TikTok's 4GB video size limit. */
const DEFAULT_CHUNK_SIZE = 10_000_000
const TIKTOK_ERROR_RESPONSE_MAX_BYTES = 64 * 1024

/** Maximum size this route will buffer in memory for a single file-upload request. TikTok's
 * own limit is 4GB, but relaying that much through this server's memory per request isn't
 * safe under concurrent load. Enforced before downloading the file so an oversized upload
 * fails fast with a clean 413 instead of materializing hundreds of MB to multiple GB
 * in-process. */
const TIKTOK_MAX_VIDEO_BYTES = 250 * 1024 * 1024

function computeChunkPlan(totalBytes: number): { chunkSize: number; totalChunkCount: number } {
  if (totalBytes <= DEFAULT_CHUNK_SIZE) {
    return { chunkSize: totalBytes, totalChunkCount: 1 }
  }
  const totalChunkCount = Math.floor(totalBytes / DEFAULT_CHUNK_SIZE)
  return { chunkSize: DEFAULT_CHUNK_SIZE, totalChunkCount }
}

function resolveVideoMimeType(fileName: string, fileType: string | undefined): string | null {
  if (fileType && TIKTOK_VIDEO_MIME_TYPES.has(fileType)) return fileType
  const fromExtension = getMimeTypeFromExtension(getFileExtension(fileName))
  return TIKTOK_VIDEO_MIME_TYPES.has(fromExtension) ? fromExtension : null
}

async function validateDirectPostSettings(
  accessToken: string,
  postInfo: { privacy_level: string; brand_content_toggle: boolean },
  requestId: string
): Promise<string | null> {
  if (postInfo.brand_content_toggle && postInfo.privacy_level === 'SELF_ONLY') {
    return 'Branded content cannot use Only Me privacy.'
  }

  const response = await fetch('https://open.tiktokapis.com/v2/post/publish/creator_info/query/', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json; charset=UTF-8',
    },
    body: '{}',
  })
  const data = await response.json()
  if (!response.ok || (data.error?.code && data.error.code !== 'ok')) {
    logger.warn(`[${requestId}] TikTok creator-info preflight failed`, {
      status: response.status,
      code: data.error?.code,
    })
    return data.error?.message || 'TikTok creator information could not be verified.'
  }

  const privacyOptions: unknown = data.data?.privacy_level_options
  if (
    !Array.isArray(privacyOptions) ||
    !privacyOptions.some((option) => option === postInfo.privacy_level)
  ) {
    return `The selected privacy level (${postInfo.privacy_level}) is not currently available for this TikTok account. Run Query Creator Info and choose one of the returned options.`
  }

  return null
}

async function uploadChunks(
  uploadUrl: string,
  buffer: Buffer,
  mimeType: string,
  requestId: string
): Promise<void> {
  const totalBytes = buffer.length
  const { chunkSize, totalChunkCount } = computeChunkPlan(totalBytes)

  for (let i = 0; i < totalChunkCount; i++) {
    const start = i * chunkSize
    const isLastChunk = i === totalChunkCount - 1
    const end = isLastChunk ? totalBytes - 1 : start + chunkSize - 1
    const chunk = buffer.subarray(start, end + 1)

    const response = await fetch(uploadUrl, {
      method: 'PUT',
      headers: {
        'Content-Type': mimeType,
        'Content-Length': String(chunk.length),
        'Content-Range': `bytes ${start}-${end}/${totalBytes}`,
      },
      body: new Uint8Array(chunk),
    })

    if (!response.ok) {
      const errorText = await readResponseTextWithLimit(response, {
        maxBytes: TIKTOK_ERROR_RESPONSE_MAX_BYTES,
        label: 'TikTok upload error response',
      }).catch(() => 'Error response exceeded the allowed size')
      logger.error(`[${requestId}] TikTok chunk upload failed`, {
        chunkIndex: i,
        status: response.status,
        errorText,
      })
      throw new Error(
        `TikTok rejected video chunk ${i + 1}/${totalChunkCount}: ${response.status} ${errorText || response.statusText}`
      )
    }
  }
}

export const POST = withRouteHandler(async (request: NextRequest) => {
  const requestId = generateRequestId()

  try {
    const authResult = await checkInternalAuth(request, { requireWorkflowId: false })
    if (!authResult.success || !authResult.userId) {
      logger.warn(`[${requestId}] Unauthorized TikTok publish-video attempt: ${authResult.error}`)
      return NextResponse.json(
        { success: false, error: authResult.error || 'Authentication required' },
        { status: 401 }
      )
    }

    const parsed = await parseRequest(tiktokPublishVideoContract, request, {})
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

    if (data.mode === 'direct') {
      const settingsError = await validateDirectPostSettings(
        data.accessToken,
        data.postInfo,
        requestId
      )
      if (settingsError) {
        return NextResponse.json({ success: false, error: settingsError }, { status: 400 })
      }
    }

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

    logger.info(`[${requestId}] Downloading video from storage`, {
      fileName: userFile.name,
      size: userFile.size,
    })

    const fileBuffer = await downloadFileFromStorage(userFile, requestId, logger, {
      maxBytes: TIKTOK_MAX_VIDEO_BYTES,
    })
    if (fileBuffer.length === 0) {
      return NextResponse.json(
        { success: false, error: 'The video file is empty.' },
        { status: 400 }
      )
    }
    const { chunkSize, totalChunkCount } = computeChunkPlan(fileBuffer.length)

    const initUrl =
      data.mode === 'draft'
        ? 'https://open.tiktokapis.com/v2/post/publish/inbox/video/init/'
        : 'https://open.tiktokapis.com/v2/post/publish/video/init/'

    const initBody: Record<string, unknown> = {
      source_info: {
        source: 'FILE_UPLOAD',
        video_size: fileBuffer.length,
        chunk_size: chunkSize,
        total_chunk_count: totalChunkCount,
      },
    }
    if (data.mode === 'direct') {
      initBody.post_info = data.postInfo
    }

    logger.info(`[${requestId}] Initializing TikTok video ${data.mode}`, {
      videoSize: fileBuffer.length,
      chunkSize,
      totalChunkCount,
    })

    const initResponse = await fetch(initUrl, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${data.accessToken}`,
        'Content-Type': 'application/json; charset=UTF-8',
      },
      body: JSON.stringify(initBody),
    })

    const { data: initData, error: initError } = await readTikTokApiResponse(
      initResponse,
      tiktokPublishInitApiDataSchema
    )

    if (initError) {
      logger.error(`[${requestId}] TikTok init failed`, { error: initError })
      return NextResponse.json(
        { success: false, error: initError.message || 'Failed to initialize TikTok upload' },
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
      await uploadChunks(uploadUrl, fileBuffer, mimeType, requestId)
    } catch (error) {
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
    logger.error(`[${requestId}] Error publishing video to TikTok:`, error)
    return NextResponse.json(
      { success: false, error: getErrorMessage(error, 'Internal server error') },
      { status: 500 }
    )
  }
})
