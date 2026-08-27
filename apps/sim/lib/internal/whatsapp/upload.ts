import { createLogger } from '@sim/logger'
import { readWhatsAppGraphResponse } from '@/lib/internal/whatsapp/client'
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

const logger = createLogger('WhatsAppMediaUpload')

export interface UploadedWhatsAppMedia {
  mediaId: string
  fileName: string
  mimeType: string
  size: number
}

export type UploadWhatsAppMediaResult =
  | { ok: true; media: UploadedWhatsAppMedia }
  | { ok: false; error: string; status: number }
  | { ok: false; response: Response }

export async function uploadWhatsAppMedia({
  file,
  accessToken,
  phoneNumberId,
  userId,
  requestId,
  signal,
}: {
  file: RawFileInput
  accessToken: string
  phoneNumberId: string
  userId: string
  requestId: string
  signal?: AbortSignal
}): Promise<UploadWhatsAppMediaResult> {
  signal?.throwIfAborted()
  const userFile = processSingleFileToUserFile(file, requestId, logger)
  if (!userFile) return { ok: false, error: 'No valid file provided for upload', status: 400 }

  const denied = await assertToolFileAccess(userFile.key, userId, requestId, logger)
  if (denied) return { ok: false, response: denied }
  signal?.throwIfAborted()

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
    signal?.throwIfAborted()
    const notReady = docNotReadyResponse(error)
    if (notReady) return { ok: false, response: notReady }
    throw error
  }

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

  const response = await fetch(buildMediaUploadUrl(phoneNumberId), {
    method: 'POST',
    headers: { Authorization: `Bearer ${accessToken.trim()}` },
    body: formData,
    signal,
  })
  const data = await readWhatsAppGraphResponse(response, 'WhatsApp media upload response', signal)

  if (!response.ok) {
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

  return {
    ok: true,
    media: { mediaId, fileName: userFile.name, mimeType: resolvedMimeType, size: buffer.length },
  }
}
