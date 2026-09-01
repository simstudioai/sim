import { createLogger } from '@sim/logger'
import { getErrorMessage } from '@sim/utils/errors'
import { isRecordLike } from '@sim/utils/object'
import {
  secureFetchWithPinnedIP,
  validateUrlWithDNS,
} from '@/lib/core/security/input-validation.server'
import {
  isPayloadSizeLimitError,
  readResponseToBufferWithLimit,
} from '@/lib/core/utils/stream-limits'
import { readWhatsAppGraphResponse } from '@/lib/internal/whatsapp/client'
import type {
  WhatsAppGetMediaInput,
  WhatsAppSendMediaInput,
  WhatsAppUploadMediaInput,
} from '@/lib/internal/whatsapp/schema'
import {
  whatsappGetMediaOutputSchema,
  whatsappSendMediaOutputSchema,
  whatsappUploadMediaOutputSchema,
} from '@/lib/internal/whatsapp/schema'
import { uploadWhatsAppMedia } from '@/lib/internal/whatsapp/upload'
import { uploadCopilotFile } from '@/lib/uploads/contexts/copilot'
import { uploadExecutionFile } from '@/lib/uploads/contexts/execution'
import { getExtensionFromMimeType } from '@/lib/uploads/utils/file-utils'
import { sanitizeFileName } from '@/executor/constants'
import type { UserFile } from '@/executor/types'
import {
  buildAuthHeaders,
  buildMediaMessageBody,
  buildMediaUrl,
  buildMessagesUrl,
  extractWhatsAppErrorMessage,
  WHATSAPP_MEDIA_MAX_BYTES,
} from '@/tools/whatsapp/utils'

const logger = createLogger('WhatsAppOperations')
const DOWNLOAD_USER_AGENT = 'SimWhatsAppMedia/1.0'

export interface WhatsAppOperationContext {
  userId: string
  requestId: string
  workspaceId?: string
  workflowId?: string
  executionId?: string
  signal?: AbortSignal
}

interface WhatsAppMediaMetadata {
  url: string
  mimeType: string
  fileSize: number | null
  sha256: string | null
  id: string
}

function failureResponse(error: string, status: number): Response {
  return Response.json({ success: false, error }, { status })
}

function normalizeSendOutput(data: Record<string, unknown>) {
  const contacts = Array.isArray(data.contacts)
    ? data.contacts.filter(isRecordLike).map((contact) => ({
        input: typeof contact.input === 'string' ? contact.input : '',
        wa_id: typeof contact.wa_id === 'string' ? contact.wa_id : null,
      }))
    : []
  const firstMessage =
    Array.isArray(data.messages) && isRecordLike(data.messages[0]) ? data.messages[0] : undefined
  const messageId = typeof firstMessage?.id === 'string' ? firstMessage.id : undefined
  if (!messageId) throw new Error('WhatsApp API response did not include a message ID')

  return {
    success: true as const,
    messageId,
    ...(typeof firstMessage?.message_status === 'string'
      ? { messageStatus: firstMessage.message_status }
      : {}),
    ...(typeof data.messaging_product === 'string'
      ? { messagingProduct: data.messaging_product }
      : {}),
    inputPhoneNumber: contacts[0]?.input ?? null,
    whatsappUserId: contacts[0]?.wa_id ?? null,
    contacts,
  }
}

export async function executeWhatsAppUploadMedia(
  input: WhatsAppUploadMediaInput,
  context: WhatsAppOperationContext
): Promise<Response> {
  context.signal?.throwIfAborted()
  try {
    const result = await uploadWhatsAppMedia({ ...input, ...context })
    if (!result.ok) {
      return 'response' in result ? result.response : failureResponse(result.error, result.status)
    }
    return Response.json({
      success: true,
      output: whatsappUploadMediaOutputSchema.parse(result.media),
    })
  } catch (error) {
    context.signal?.throwIfAborted()
    return failureResponse(
      getErrorMessage(error, 'Failed to upload media to WhatsApp'),
      isPayloadSizeLimitError(error) ? 413 : 500
    )
  }
}

export async function executeWhatsAppSendMedia(
  input: WhatsAppSendMediaInput,
  context: WhatsAppOperationContext
): Promise<Response> {
  context.signal?.throwIfAborted()
  const sourceCount = [input.file, input.mediaId, input.mediaLink].filter(Boolean).length
  if (sourceCount === 0) return failureResponse('Provide a file, a media ID, or a media link', 400)
  if (sourceCount > 1) {
    return failureResponse('Provide only one of file, media ID, or media link', 400)
  }

  try {
    let uploadedMediaId: string | undefined
    let filename = input.filename ?? undefined
    if (input.file) {
      const uploaded = await uploadWhatsAppMedia({
        file: input.file,
        accessToken: input.accessToken,
        phoneNumberId: input.phoneNumberId,
        userId: context.userId,
        requestId: context.requestId,
        signal: context.signal,
      })
      if (!uploaded.ok) {
        return 'response' in uploaded
          ? uploaded.response
          : failureResponse(uploaded.error, uploaded.status)
      }
      uploadedMediaId = uploaded.media.mediaId
      filename = filename ?? uploaded.media.fileName
    }

    const messageBody = buildMediaMessageBody({
      phoneNumber: input.phoneNumber,
      mediaType: input.mediaType,
      mediaId: uploadedMediaId ?? input.mediaId ?? undefined,
      mediaLink: input.mediaLink ?? undefined,
      caption: input.caption ?? undefined,
      filename,
    })
    const response = await fetch(buildMessagesUrl(input.phoneNumberId), {
      method: 'POST',
      headers: buildAuthHeaders(input.accessToken),
      body: JSON.stringify(messageBody),
      signal: context.signal,
    })
    const data = await readWhatsAppGraphResponse(
      response,
      'WhatsApp media send response',
      context.signal
    )
    if (!response.ok) throw new Error(extractWhatsAppErrorMessage(data, response.status))

    const output = whatsappSendMediaOutputSchema.parse({
      ...normalizeSendOutput(data),
      ...(uploadedMediaId ? { mediaId: uploadedMediaId } : {}),
    })
    return Response.json({ success: true, output })
  } catch (error) {
    context.signal?.throwIfAborted()
    return failureResponse(
      getErrorMessage(error, 'Failed to send WhatsApp media'),
      isPayloadSizeLimitError(error) ? 413 : 500
    )
  }
}

export async function executeWhatsAppGetMedia(
  input: WhatsAppGetMediaInput,
  context: WhatsAppOperationContext
): Promise<Response> {
  context.signal?.throwIfAborted()
  const authorization = `Bearer ${input.accessToken.trim()}`
  try {
    const metadataResponse = await fetch(buildMediaUrl(input.mediaId, input.phoneNumberId), {
      headers: { Authorization: authorization },
      signal: context.signal,
    })
    const metadataBody = await readWhatsAppGraphResponse(
      metadataResponse,
      `WhatsApp media ${input.mediaId} metadata`,
      context.signal
    )
    if (!metadataResponse.ok) {
      return failureResponse(
        extractWhatsAppErrorMessage(metadataBody, metadataResponse.status),
        metadataResponse.status >= 400 && metadataResponse.status < 500
          ? metadataResponse.status
          : 502
      )
    }

    const url = typeof metadataBody.url === 'string' ? metadataBody.url : undefined
    if (!url) return failureResponse('WhatsApp media metadata did not include a download URL', 502)
    const parsedSize = Number(metadataBody.file_size)
    const metadata: WhatsAppMediaMetadata = {
      url,
      mimeType:
        typeof metadataBody.mime_type === 'string' && metadataBody.mime_type.length > 0
          ? metadataBody.mime_type
          : 'application/octet-stream',
      fileSize: Number.isFinite(parsedSize) ? parsedSize : null,
      sha256: typeof metadataBody.sha256 === 'string' ? metadataBody.sha256 : null,
      id: typeof metadataBody.id === 'string' ? metadataBody.id : input.mediaId,
    }
    if (metadata.fileSize !== null && metadata.fileSize > WHATSAPP_MEDIA_MAX_BYTES) {
      return failureResponse(
        `WhatsApp media is ${(metadata.fileSize / (1024 * 1024)).toFixed(2)} MB, which exceeds the 100 MB download limit`,
        413
      )
    }

    const urlValidation = await validateUrlWithDNS(metadata.url, 'mediaUrl', 'contentFetch')
    if (!urlValidation.isValid) {
      return failureResponse(`Invalid WhatsApp media URL: ${urlValidation.error}`, 502)
    }
    const mediaResponse = await secureFetchWithPinnedIP(metadata.url, urlValidation.resolvedIP, {
      profile: 'contentFetch',
      method: 'GET',
      headers: { Authorization: authorization, 'User-Agent': DOWNLOAD_USER_AGENT },
      maxResponseBytes: WHATSAPP_MEDIA_MAX_BYTES,
      stripAuthOnRedirect: true,
      signal: context.signal,
    })
    if (!mediaResponse.ok) {
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
      signal: context.signal,
    })
    const extension = getExtensionFromMimeType(metadata.mimeType) ?? 'bin'
    const fileName = sanitizeFileName(`whatsapp-${metadata.id}.${extension}`)
    const executionScope =
      context.workspaceId && context.workflowId && context.executionId
        ? {
            workspaceId: context.workspaceId,
            workflowId: context.workflowId,
            executionId: context.executionId,
          }
        : undefined
    const file: UserFile = executionScope
      ? await uploadExecutionFile(
          executionScope,
          buffer,
          fileName,
          metadata.mimeType,
          context.userId
        )
      : await uploadCopilotFile({
          buffer,
          fileName,
          contentType: metadata.mimeType,
          userId: context.userId,
        })
    context.signal?.throwIfAborted()

    const output = whatsappGetMediaOutputSchema.parse({
      file,
      mediaId: metadata.id,
      mimeType: metadata.mimeType,
      fileSize: buffer.length,
      sha256: metadata.sha256,
    })
    return Response.json({ success: true, output })
  } catch (error) {
    context.signal?.throwIfAborted()
    if (isPayloadSizeLimitError(error)) {
      return failureResponse('WhatsApp media exceeds the 100 MB download limit', 413)
    }
    logger.error('WhatsApp media download failed', {
      error: getErrorMessage(error),
      requestId: context.requestId,
    })
    return failureResponse(getErrorMessage(error, 'Failed to download WhatsApp media'), 500)
  }
}
