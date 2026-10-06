import { createLogger } from '@sim/logger'
import { getErrorMessage } from '@sim/utils/errors'
import { isRecordLike } from '@sim/utils/object'
import type { EgressProfile } from '@/lib/core/security/egress/profiles'
import {
  type SecureFetchResponse,
  secureFetchWithValidation,
} from '@/lib/core/security/input-validation.server'
import {
  DEFAULT_MAX_ERROR_BODY_BYTES,
  isPayloadSizeLimitError,
  readResponseJsonWithLimit,
  readResponseTextWithLimit,
} from '@/lib/core/utils/stream-limits'
import type { PlaneUploadAttachmentInput } from '@/lib/internal/plane/schema'
import { MAX_BUFFERED_TRANSFER_BYTES } from '@/lib/uploads/shared/types'
import { processFilesToUserFiles } from '@/lib/uploads/utils/file-utils'
import { downloadServableFileFromStorage } from '@/lib/uploads/utils/file-utils.server'
import { docNotReadyResponse } from '@/lib/uploads/utils/servable-file-response'
import { assertToolFileAccess } from '@/app/api/files/authorization'
import { ErrorExtractorId, extractErrorMessage } from '@/tools/error-extractors'
import {
  mapPlaneAttachment,
  normalizePlaneBaseUrl,
  planeHeaders,
  planePathSegment,
  planeWorkItemUrl,
} from '@/tools/plane/utils'

const logger = createLogger('PlaneAttachmentUpload')
const MAX_PLANE_JSON_BYTES = 2 * 1024 * 1024

interface PlaneOperationContext {
  userId: string
  requestId: string
  signal?: AbortSignal
}

class PlaneUploadError extends Error {
  constructor(
    message: string,
    readonly status: number
  ) {
    super(message)
    this.name = 'PlaneUploadError'
  }
}

function failure(error: string, status: number): Response {
  return Response.json({ success: false, error }, { status })
}

async function readPlaneError(response: SecureFetchResponse, signal?: AbortSignal) {
  const text = await readResponseTextWithLimit(response, {
    maxBytes: DEFAULT_MAX_ERROR_BODY_BYTES,
    label: 'Plane error response',
    signal,
  }).catch(() => '')
  let data: unknown = text
  try {
    data = JSON.parse(text)
  } catch {}
  return extractErrorMessage(
    { status: response.status, statusText: response.statusText, data },
    ErrorExtractorId.PLANE_ERRORS
  )
}

/** Maps a Plane failure status to the status this operation reports. */
function upstreamStatus(status: number): number {
  return status >= 400 && status < 500 ? status : 502
}

async function planeRequest(
  url: string,
  init: { method: string; apiKey: string; body?: Record<string, unknown> },
  signal?: AbortSignal
): Promise<SecureFetchResponse> {
  return secureFetchWithValidation(
    url,
    {
      profile: 'configuredEndpoint',
      method: init.method,
      headers: planeHeaders({ apiKey: init.apiKey }),
      body: init.body ? JSON.stringify(init.body) : undefined,
      maxResponseBytes: MAX_PLANE_JSON_BYTES,
      signal,
    },
    'baseUrl'
  )
}

/**
 * Plane returns a storage-signed upload URL. On Plane Cloud it is an S3 host; on a self-hosted
 * instance using its bundled MinIO it is the instance's own origin. A URL on the operator-configured
 * Plane origin carries that origin's trust; any other host is response-derived content.
 */
function uploadEgressProfile(uploadUrl: string, baseUrl: string): EgressProfile {
  try {
    return new URL(uploadUrl).origin === new URL(baseUrl).origin
      ? 'configuredEndpoint'
      : 'contentFetch'
  } catch {
    return 'contentFetch'
  }
}

function readUploadTicket(data: unknown) {
  if (!isRecordLike(data)) return null
  const uploadData = data.upload_data
  if (!isRecordLike(uploadData) || typeof uploadData.url !== 'string') return null
  if (!isRecordLike(uploadData.fields)) return null
  const fields: [string, string][] = []
  for (const [name, value] of Object.entries(uploadData.fields)) {
    if (typeof value !== 'string') return null
    fields.push([name, value])
  }
  const assetId =
    typeof data.asset_id === 'string'
      ? data.asset_id
      : isRecordLike(data.attachment) && typeof data.attachment.id === 'string'
        ? data.attachment.id
        : null
  if (!assetId || !isRecordLike(data.attachment)) return null
  return { url: uploadData.url, fields, assetId, attachment: data.attachment }
}

async function discardPendingAttachment(
  input: PlaneUploadAttachmentInput,
  assetId: string,
  signal?: AbortSignal
) {
  try {
    const response = await planeRequest(
      planeWorkItemUrl(input, `attachments/${planePathSegment(assetId, 'attachmentId')}/`),
      { method: 'DELETE', apiKey: input.apiKey },
      signal
    )
    await response.body?.cancel().catch(() => {})
  } catch (error) {
    logger.warn('Failed to discard pending Plane attachment', {
      error: getErrorMessage(error),
    })
  }
}

/**
 * Uploads a stored workflow file to a Plane work item using Plane's three-step flow: request a
 * signed storage upload, POST the bytes to storage, then confirm the upload with Plane.
 */
export async function executePlaneUploadAttachment(
  input: PlaneUploadAttachmentInput,
  context: PlaneOperationContext
): Promise<Response> {
  try {
    context.signal?.throwIfAborted()
    const userFile = processFilesToUserFiles([input.file], context.requestId, logger)[0]
    if (!userFile) return failure('Invalid file input', 400)
    const denied = await assertToolFileAccess(
      userFile.key,
      context.userId,
      context.requestId,
      logger
    )
    context.signal?.throwIfAborted()
    if (denied) return denied

    const { buffer, contentType: storedContentType } = await downloadServableFileFromStorage(
      userFile,
      context.requestId,
      logger,
      { maxBytes: MAX_BUFFERED_TRANSFER_BYTES, signal: context.signal }
    )
    context.signal?.throwIfAborted()
    if (buffer.length === 0) return failure('File is empty', 400)

    const mimeType = (storedContentType || userFile.type || 'application/octet-stream')
      .split(';')[0]
      .trim()
      .toLowerCase()

    const created = await planeRequest(
      planeWorkItemUrl(input, 'attachments/'),
      {
        method: 'POST',
        apiKey: input.apiKey,
        body: { name: userFile.name, type: mimeType, size: buffer.length },
      },
      context.signal
    )
    if (!created.ok) {
      const message = await readPlaneError(created, context.signal)
      throw new PlaneUploadError(
        created.status === 400 && message === 'Invalid file type.'
          ? `Plane does not accept attachments of type ${mimeType}`
          : message,
        upstreamStatus(created.status)
      )
    }
    const ticket = readUploadTicket(
      await readResponseJsonWithLimit<unknown>(created, {
        maxBytes: MAX_PLANE_JSON_BYTES,
        label: 'Plane attachment response',
        signal: context.signal,
      })
    )
    if (!ticket) {
      throw new PlaneUploadError('Plane did not return a storage upload URL', 502)
    }

    const allowedSize = ticket.attachment.size
    if (typeof allowedSize === 'number' && allowedSize < buffer.length) {
      await discardPendingAttachment(input, ticket.assetId, context.signal)
      const limitMb = (allowedSize / (1024 * 1024)).toFixed(2)
      throw new PlaneUploadError(
        `File size exceeds this Plane instance's attachment limit of ${limitMb}MB`,
        413
      )
    }

    const form = new FormData()
    for (const [name, value] of ticket.fields) form.append(name, value)
    form.append('file', new Blob([new Uint8Array(buffer)], { type: mimeType }), userFile.name)
    const encoded = new Response(form)
    const multipartType = encoded.headers.get('content-type')
    if (!multipartType) throw new PlaneUploadError('Failed to encode the upload form', 500)
    const multipartBody = new Uint8Array(await encoded.arrayBuffer())

    const baseUrl = normalizePlaneBaseUrl(input.baseUrl)
    const uploaded = await secureFetchWithValidation(
      ticket.url,
      {
        profile: uploadEgressProfile(ticket.url, baseUrl),
        method: 'POST',
        headers: {
          'Content-Type': multipartType,
          'Content-Length': String(multipartBody.byteLength),
        },
        body: multipartBody,
        maxResponseBytes: DEFAULT_MAX_ERROR_BODY_BYTES,
        signal: context.signal,
      },
      'uploadUrl'
    )
    if (!uploaded.ok) {
      await readResponseTextWithLimit(uploaded, {
        maxBytes: DEFAULT_MAX_ERROR_BODY_BYTES,
        label: 'Plane storage upload error response',
        signal: context.signal,
      }).catch(() => '')
      await discardPendingAttachment(input, ticket.assetId, context.signal)
      throw new PlaneUploadError(
        `Failed to upload file bytes to Plane storage (HTTP ${uploaded.status})`,
        502
      )
    }
    await uploaded.body?.cancel().catch(() => {})

    const confirmed = await planeRequest(
      planeWorkItemUrl(input, `attachments/${planePathSegment(ticket.assetId, 'attachmentId')}/`),
      { method: 'PATCH', apiKey: input.apiKey, body: { is_uploaded: true } },
      context.signal
    )
    if (!confirmed.ok) {
      const message = await readPlaneError(confirmed, context.signal)
      throw new PlaneUploadError(message, upstreamStatus(confirmed.status))
    }
    await confirmed.body?.cancel().catch(() => {})
    context.signal?.throwIfAborted()

    return Response.json({
      success: true,
      output: {
        attachment: { ...mapPlaneAttachment(ticket.attachment), isUploaded: true },
      },
    })
  } catch (error) {
    context.signal?.throwIfAborted()
    if (error instanceof PlaneUploadError) return failure(error.message, error.status)
    const notReady = docNotReadyResponse(error)
    if (notReady) return notReady
    logger.error(`[${context.requestId}] Plane attachment upload failed`, {
      error: getErrorMessage(error),
    })
    return failure(
      getErrorMessage(error, 'Unknown Plane upload error'),
      isPayloadSizeLimitError(error) ? 413 : 500
    )
  }
}
