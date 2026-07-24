import { createLogger } from '@sim/logger'
import { getErrorMessage } from '@sim/utils/errors'
import { type NextRequest, NextResponse } from 'next/server'
import {
  type WhatsAppGetMediaRouteResponse,
  whatsappGetMediaContract,
  whatsappGetMediaOutputSchema,
} from '@/lib/api/contracts/tools/whatsapp'
import { getValidationErrorMessage, parseRequest } from '@/lib/api/server'
import { checkInternalAuth } from '@/lib/auth/hybrid'
import {
  secureFetchWithPinnedIP,
  validateUrlWithDNS,
} from '@/lib/core/security/input-validation.server'
import { generateRequestId } from '@/lib/core/utils/request'
import {
  isPayloadSizeLimitError,
  readResponseJsonWithLimit,
  readResponseToBufferWithLimit,
} from '@/lib/core/utils/stream-limits'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'
import { uploadCopilotFile } from '@/lib/uploads/contexts/copilot'
import { uploadExecutionFile } from '@/lib/uploads/contexts/execution'
import { getExtensionFromMimeType } from '@/lib/uploads/utils/file-utils'
import { sanitizeFileName } from '@/executor/constants'
import type { UserFile } from '@/executor/types'
import {
  buildMediaUrl,
  extractWhatsAppErrorMessage,
  WHATSAPP_MEDIA_MAX_BYTES,
} from '@/tools/whatsapp/utils'

export const dynamic = 'force-dynamic'
export const maxDuration = 300

const logger = createLogger('WhatsAppGetMediaAPI')

const MAX_GRAPH_METADATA_BYTES = 256 * 1024

/**
 * Meta's CDN is reported to reject requests without a conventional User-Agent.
 * This is not documented behavior, so it is sent defensively rather than relied upon.
 */
const DOWNLOAD_USER_AGENT = 'SimWhatsAppMedia/1.0'

function failureResponse(error: string, status: number) {
  const body = { success: false, error } satisfies WhatsAppGetMediaRouteResponse
  return NextResponse.json(body, { status })
}

interface WhatsAppMediaMetadata {
  url: string
  mimeType: string
  fileSize: number | null
  sha256: string | null
  id: string
}

export const POST = withRouteHandler(async (request: NextRequest) => {
  const requestId = generateRequestId()

  const authResult = await checkInternalAuth(request, { requireWorkflowId: false })
  if (!authResult.success || !authResult.userId) {
    logger.warn(`[${requestId}] Unauthorized WhatsApp media download attempt: ${authResult.error}`)
    return failureResponse(authResult.error || 'Authentication required', 401)
  }

  const parsed = await parseRequest(
    whatsappGetMediaContract,
    request,
    {},
    {
      validationErrorResponse: (error) =>
        failureResponse(getValidationErrorMessage(error, 'Invalid request data'), 400),
    }
  )
  if (!parsed.success) return parsed.response

  const { accessToken, mediaId, phoneNumberId, workspaceId, workflowId, executionId } =
    parsed.data.body
  const authorization = `Bearer ${accessToken.trim()}`

  try {
    const metadataResponse = await fetch(buildMediaUrl(mediaId, phoneNumberId), {
      headers: { Authorization: authorization },
      signal: request.signal,
    })

    const metadataBody = await readResponseJsonWithLimit<Record<string, unknown>>(
      metadataResponse,
      {
        maxBytes: MAX_GRAPH_METADATA_BYTES,
        label: `WhatsApp media ${mediaId} metadata`,
        signal: request.signal,
      }
    )

    if (!metadataResponse.ok) {
      const message = extractWhatsAppErrorMessage(metadataBody, metadataResponse.status)
      logger.error(`[${requestId}] WhatsApp media lookup failed`, {
        status: metadataResponse.status,
      })
      return failureResponse(
        message,
        metadataResponse.status >= 400 && metadataResponse.status < 500
          ? metadataResponse.status
          : 502
      )
    }

    const url = typeof metadataBody.url === 'string' ? metadataBody.url : undefined
    if (!url) {
      return failureResponse('WhatsApp media metadata did not include a download URL', 502)
    }

    // file_size comes back as a string in some responses, so coerce before comparing.
    const parsedSize = Number(metadataBody.file_size)
    const metadata: WhatsAppMediaMetadata = {
      url,
      mimeType:
        typeof metadataBody.mime_type === 'string' && metadataBody.mime_type.length > 0
          ? metadataBody.mime_type
          : 'application/octet-stream',
      fileSize: Number.isFinite(parsedSize) ? parsedSize : null,
      sha256: typeof metadataBody.sha256 === 'string' ? metadataBody.sha256 : null,
      id: typeof metadataBody.id === 'string' ? metadataBody.id : mediaId,
    }

    // Reject oversized media from the declared size before spending bandwidth on it.
    if (metadata.fileSize !== null && metadata.fileSize > WHATSAPP_MEDIA_MAX_BYTES) {
      return failureResponse(
        `WhatsApp media is ${(metadata.fileSize / (1024 * 1024)).toFixed(2)} MB, which exceeds the 100 MB download limit`,
        413
      )
    }

    // The media URL points at Meta's CDN and still requires the bearer token.
    const urlValidation = await validateUrlWithDNS(metadata.url, 'mediaUrl')
    if (!urlValidation.isValid) {
      return failureResponse(`Invalid WhatsApp media URL: ${urlValidation.error}`, 502)
    }

    const mediaResponse = await secureFetchWithPinnedIP(metadata.url, urlValidation.resolvedIP!, {
      method: 'GET',
      headers: {
        Authorization: authorization,
        'User-Agent': DOWNLOAD_USER_AGENT,
      },
      maxResponseBytes: WHATSAPP_MEDIA_MAX_BYTES,
      stripAuthOnRedirect: true,
      signal: request.signal,
    })

    if (!mediaResponse.ok) {
      logger.error(`[${requestId}] WhatsApp media download failed`, {
        status: mediaResponse.status,
      })
      return failureResponse(
        mediaResponse.status === 404
          ? 'WhatsApp media not found or its download URL expired (URLs are valid for 5 minutes)'
          : `Failed to download WhatsApp media (${mediaResponse.status})`,
        mediaResponse.status >= 400 && mediaResponse.status < 500 ? mediaResponse.status : 502
      )
    }

    const buffer = await readResponseToBufferWithLimit(mediaResponse, {
      maxBytes: WHATSAPP_MEDIA_MAX_BYTES,
      label: 'WhatsApp media download',
    })

    const extension = getExtensionFromMimeType(metadata.mimeType) ?? 'bin'
    const fileName = sanitizeFileName(`whatsapp-${metadata.id}.${extension}`)

    const file: UserFile =
      workspaceId && workflowId && executionId
        ? await uploadExecutionFile(
            { workspaceId, workflowId, executionId },
            buffer,
            fileName,
            metadata.mimeType,
            authResult.userId
          )
        : await uploadCopilotFile({
            buffer,
            fileName,
            contentType: metadata.mimeType,
            userId: authResult.userId,
          })

    logger.info(`[${requestId}] WhatsApp media downloaded`, {
      mediaId: metadata.id,
      mimeType: metadata.mimeType,
      size: buffer.length,
    })

    const output = whatsappGetMediaOutputSchema.parse({
      file,
      mediaId: metadata.id,
      mimeType: metadata.mimeType,
      fileSize: buffer.length,
      sha256: metadata.sha256,
    })

    return NextResponse.json({
      success: true,
      output,
    } satisfies WhatsAppGetMediaRouteResponse)
  } catch (error) {
    logger.error(`[${requestId}] WhatsApp media download failed`, { error })

    if (isPayloadSizeLimitError(error)) {
      return failureResponse('WhatsApp media exceeds the 100 MB download limit', 413)
    }

    return failureResponse(getErrorMessage(error, 'Failed to download WhatsApp media'), 500)
  }
})
