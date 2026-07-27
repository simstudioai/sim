import type { Logger } from '@sim/logger'
import type { NextResponse } from 'next/server'
import { readResponseJsonWithLimit } from '@/lib/core/utils/stream-limits'
import type { RawFileInput } from '@/lib/uploads/utils/file-utils'
import { processSingleFileToUserFile } from '@/lib/uploads/utils/file-utils'
import { downloadServableFileFromStorage } from '@/lib/uploads/utils/file-utils.server'
import { docNotReadyResponse } from '@/lib/uploads/utils/servable-file-response'
import { assertToolFileAccess } from '@/app/api/files/authorization'
import {
  buildMediaUploadUrl,
  extractWhatsAppErrorMessage,
  whatsappMediaLimitFor,
} from '@/tools/whatsapp/utils'

/** WhatsApp error and upload envelopes are small; cap the read so a hostile body cannot balloon memory. */
const MAX_GRAPH_RESPONSE_BYTES = 256 * 1024

export interface UploadedWhatsAppMedia {
  mediaId: string
  fileName: string
  mimeType: string
  size: number
}

export type UploadWhatsAppMediaResult =
  | { ok: true; media: UploadedWhatsAppMedia }
  | { ok: false; error: string; status: number }
  | { ok: false; response: NextResponse }

/**
 * Pull a stored user file, enforce WhatsApp's documented per-type size ceiling, and
 * upload it to `/{phone-number-id}/media`. Shared by the standalone Upload Media
 * operation and the file path of Send Media.
 */
export async function uploadWhatsAppMedia({
  file,
  accessToken,
  phoneNumberId,
  userId,
  requestId,
  logger,
  signal,
}: {
  file: RawFileInput
  accessToken: string
  phoneNumberId: string
  userId: string
  requestId: string
  logger: Logger
  signal?: AbortSignal
}): Promise<UploadWhatsAppMediaResult> {
  const userFile = processSingleFileToUserFile(file, requestId, logger)
  if (!userFile) {
    return { ok: false, error: 'No valid file provided for upload', status: 400 }
  }

  const denied = await assertToolFileAccess(userFile.key, userId, requestId, logger)
  if (denied) return { ok: false, response: denied }

  // Check the declared size against WhatsApp's ceiling before pulling bytes, then cap
  // the storage read itself so a mis-declared size cannot blow past it.
  const declaredMimeType = userFile.type || 'application/octet-stream'
  const declaredLimit = whatsappMediaLimitFor(declaredMimeType)
  if (userFile.size > declaredLimit.maxBytes) {
    return {
      ok: false,
      error: `${userFile.name} is ${(userFile.size / (1024 * 1024)).toFixed(2)} MB, which exceeds WhatsApp's limit for ${declaredLimit.label}`,
      status: 413,
    }
  }

  let buffer: Buffer
  let contentType: string
  try {
    const downloaded = await downloadServableFileFromStorage(userFile, requestId, logger, {
      maxBytes: declaredLimit.maxBytes,
      signal,
    })
    buffer = downloaded.buffer
    contentType = downloaded.contentType
  } catch (error) {
    const notReady = docNotReadyResponse(error)
    if (notReady) return { ok: false, response: notReady }
    throw error
  }

  // downloadServableFileFromStorage can swap an AI-generated doc for its compiled
  // artifact, so re-resolve the limit against the type actually being sent.
  const resolvedMimeType = contentType || declaredMimeType
  const resolvedLimit = whatsappMediaLimitFor(resolvedMimeType)
  if (buffer.length > resolvedLimit.maxBytes) {
    return {
      ok: false,
      error: `${userFile.name} is ${(buffer.length / (1024 * 1024)).toFixed(2)} MB, which exceeds WhatsApp's limit for ${resolvedLimit.label}`,
      status: 413,
    }
  }

  const formData = new FormData()
  formData.append('messaging_product', 'whatsapp')
  formData.append('type', resolvedMimeType)
  formData.append(
    'file',
    new Blob([new Uint8Array(buffer)], { type: resolvedMimeType }),
    userFile.name
  )

  logger.info(`[${requestId}] Uploading media to WhatsApp`, {
    fileName: userFile.name,
    mimeType: resolvedMimeType,
    size: buffer.length,
  })

  // Content-Type is intentionally omitted so fetch sets the multipart boundary.
  const response = await fetch(buildMediaUploadUrl(phoneNumberId), {
    method: 'POST',
    headers: { Authorization: `Bearer ${accessToken.trim()}` },
    body: formData,
    signal,
  })

  const data = await readResponseJsonWithLimit<Record<string, unknown>>(response, {
    maxBytes: MAX_GRAPH_RESPONSE_BYTES,
    label: 'WhatsApp media upload response',
    signal,
  })

  if (!response.ok) {
    logger.error(`[${requestId}] WhatsApp media upload failed`, { status: response.status })
    return {
      ok: false,
      error: extractWhatsAppErrorMessage(data, response.status),
      status: response.status >= 400 && response.status < 500 ? response.status : 502,
    }
  }

  const mediaId = typeof data.id === 'string' ? data.id : undefined
  if (!mediaId) {
    return { ok: false, error: 'WhatsApp upload response did not include a media ID', status: 502 }
  }

  logger.info(`[${requestId}] WhatsApp media uploaded`, { mediaId })

  return {
    ok: true,
    media: { mediaId, fileName: userFile.name, mimeType: resolvedMimeType, size: buffer.length },
  }
}
