import { createLogger } from '@sim/logger'
import { getErrorMessage } from '@sim/utils/errors'
import { isRecordLike } from '@sim/utils/object'
import {
  secureFetchWithPinnedIP,
  validateUrlWithDNS,
} from '@/lib/core/security/input-validation.server'
import {
  DEFAULT_MAX_ERROR_BODY_BYTES,
  isPayloadSizeLimitError,
  readResponseJsonWithLimit,
  readResponseTextWithLimit,
} from '@/lib/core/utils/stream-limits'
import type { AshbyUploadInput } from '@/lib/internal/ashby/schema'
import { MAX_BUFFERED_TRANSFER_BYTES } from '@/lib/uploads/shared/types'
import { processFilesToUserFiles } from '@/lib/uploads/utils/file-utils'
import { downloadServableFileFromStorage } from '@/lib/uploads/utils/file-utils.server'
import { docNotReadyResponse } from '@/lib/uploads/utils/servable-file-response'
import { assertToolFileAccess } from '@/app/api/files/authorization'
import { ashbyAuthHeaders, ashbyErrorMessage, mapCandidate } from '@/tools/ashby/utils'

const logger = createLogger('AshbyFileUpload')
const MAX_ASHBY_JSON_BYTES = 2 * 1024 * 1024
const MAX_ASHBY_UPLOAD_BYTES = Math.min(MAX_BUFFERED_TRANSFER_BYTES, 25 * 1024 * 1024)

interface Context {
  userId: string
  requestId: string
  signal?: AbortSignal
}

function failure(error: string, status: number): Response {
  return Response.json({ success: false, error }, { status })
}

async function ashbyPost(
  apiKey: string,
  path: string,
  body: Record<string, unknown>,
  onBehalfOfUserId: string | null | undefined,
  signal?: AbortSignal
): Promise<unknown> {
  const response = await fetch(`https://api.ashbyhq.com/${path}`, {
    method: 'POST',
    headers: ashbyAuthHeaders(apiKey, onBehalfOfUserId ?? undefined),
    body: JSON.stringify(body),
    signal,
  })
  const data = await readResponseJsonWithLimit<unknown>(response, {
    maxBytes: MAX_ASHBY_JSON_BYTES,
    label: `Ashby ${path} response`,
    signal,
  })
  if (!response.ok || !isRecordLike(data) || data.success !== true) {
    throw new Error(ashbyErrorMessage(data, `Ashby ${path} failed (HTTP ${response.status})`))
  }
  return data.results
}

export async function executeAshbyUpload(
  input: AshbyUploadInput,
  kind: 'resume' | 'file',
  context: Context
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

    const servableFile = await downloadServableFileFromStorage(
      userFile,
      context.requestId,
      logger,
      {
        maxBytes: MAX_ASHBY_UPLOAD_BYTES,
        signal: context.signal,
      }
    )
    const { buffer } = servableFile
    context.signal?.throwIfAborted()
    if (buffer.length === 0) return failure('File is empty', 400)

    const filename = input.fileName?.trim() || userFile.name
    const contentType = servableFile.contentType || userFile.type || 'application/octet-stream'
    const registration = await ashbyPost(
      input.apiKey,
      'file.createFileUploadHandle',
      {
        fileUploadContext: kind === 'resume' ? 'CandidateResume' : 'CandidateFiles',
        filename,
        contentType,
        contentLength: buffer.length,
      },
      input.onBehalfOfUserId,
      context.signal
    )
    if (
      !isRecordLike(registration) ||
      typeof registration.handle !== 'string' ||
      typeof registration.url !== 'string' ||
      !isRecordLike(registration.fields)
    ) {
      return failure('Ashby returned an invalid file upload handle', 502)
    }

    const form = new FormData()
    form.append('Content-Type', contentType)
    for (const [name, value] of Object.entries(registration.fields)) {
      if (typeof value !== 'string')
        return failure(`Ashby returned an invalid upload form field: ${name}`, 502)
      form.append(name, value)
    }
    form.append('file', new Blob([new Uint8Array(buffer)], { type: contentType }), filename)
    const encoded = new Response(form)
    const contentTypeHeader = encoded.headers.get('content-type')
    if (!contentTypeHeader) return failure('Failed to encode Ashby upload form', 500)
    const multipartBody = new Uint8Array(await encoded.arrayBuffer())
    const validation = await validateUrlWithDNS(registration.url, 'uploadUrl', 'contentFetch')
    context.signal?.throwIfAborted()
    if (!validation.isValid) return failure(validation.error || 'Invalid Ashby upload URL', 400)
    const uploaded = await secureFetchWithPinnedIP(registration.url, validation.resolvedIP, {
      profile: 'contentFetch',
      method: 'POST',
      headers: {
        'Content-Type': contentTypeHeader,
        'Content-Length': String(multipartBody.byteLength),
      },
      body: multipartBody,
      maxResponseBytes: DEFAULT_MAX_ERROR_BODY_BYTES,
      signal: context.signal,
    })
    if (!uploaded.ok) {
      await readResponseTextWithLimit(uploaded, {
        maxBytes: DEFAULT_MAX_ERROR_BODY_BYTES,
        label: 'Ashby presigned upload error response',
        signal: context.signal,
      }).catch(() => '')
      return failure(`Failed to upload file bytes to Ashby (HTTP ${uploaded.status})`, 502)
    }

    const candidate = await ashbyPost(
      input.apiKey,
      kind === 'resume' ? 'candidate.uploadResume' : 'candidate.uploadFile',
      {
        candidateId: input.candidateId.trim(),
        [kind === 'resume' ? 'resumeHandle' : 'fileHandle']: registration.handle,
      },
      input.onBehalfOfUserId,
      context.signal
    )
    return Response.json({ success: true, output: mapCandidate(candidate) })
  } catch (error) {
    context.signal?.throwIfAborted()
    const notReady = docNotReadyResponse(error)
    if (notReady) return notReady
    logger.error(`[${context.requestId}] Ashby candidate file upload failed`, {
      error: getErrorMessage(error),
    })
    return failure(
      getErrorMessage(error, 'Unknown Ashby upload error'),
      isPayloadSizeLimitError(error) ? 413 : 500
    )
  }
}
