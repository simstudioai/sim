import { createLogger } from '@sim/logger'
import { getErrorMessage } from '@sim/utils/errors'
import { validateSupabaseProjectId } from '@/lib/core/security/input-validation'
import {
  assertKnownSizeWithinLimit,
  isPayloadSizeLimitError,
  readResponseTextWithLimit,
} from '@/lib/core/utils/stream-limits'
import type { SupabaseStorageUploadInput } from '@/lib/internal/supabase/schema'
import { MAX_BUFFERED_TRANSFER_BYTES } from '@/lib/uploads/shared/types'
import { processSingleFileToUserFile } from '@/lib/uploads/utils/file-utils'
import { downloadServableFileFromStorage } from '@/lib/uploads/utils/file-utils.server'
import { docNotReadyResponse } from '@/lib/uploads/utils/servable-file-response'
import { assertToolFileAccess } from '@/app/api/files/authorization'
import { encodeStoragePath, encodeStorageSegment } from '@/tools/supabase/utils'

const logger = createLogger('SupabaseStorageUpload')
const MAX_SUPABASE_RESPONSE_BYTES = 10 * 1024 * 1024

export interface SupabaseOperationContext {
  userId: string
  requestId: string
  signal?: AbortSignal
}

function failureResponse(error: string, status: number, details?: unknown): Response {
  return Response.json(
    details === undefined ? { success: false, error } : { success: false, error, details },
    { status }
  )
}

function decodeStringInput(value: string): Buffer {
  let content = value
  const dataUrlMatch = content.match(/^data:([^;]+);base64,(.+)$/s)
  if (dataUrlMatch) content = dataUrlMatch[2]

  const cleanedContent = content.replace(/[\s\r\n]/g, '')
  const isLikelyBase64 = /^[A-Za-z0-9+/]*={0,2}$/.test(cleanedContent)
  if (!isLikelyBase64 || cleanedContent.length < 4) return Buffer.from(content, 'utf-8')

  try {
    const decoded = Buffer.from(cleanedContent, 'base64')
    const expectedMinSize = Math.floor(cleanedContent.length * 0.7)
    const expectedMaxSize = Math.ceil(cleanedContent.length * 0.8)
    if (
      decoded.length >= expectedMinSize &&
      decoded.length <= expectedMaxSize &&
      decoded.length > 0
    ) {
      return decoded
    }
    return decoded.toString('base64') === cleanedContent ? decoded : Buffer.from(content, 'utf-8')
  } catch {
    return Buffer.from(content, 'utf-8')
  }
}

async function resolveUploadBody(
  input: SupabaseStorageUploadInput,
  context: SupabaseOperationContext
): Promise<{ body: Buffer; contentType: string } | Response> {
  if (typeof input.fileData === 'string') {
    const dataUrlType = input.fileData.match(/^data:([^;]+);base64,/s)?.[1]
    const body = decodeStringInput(input.fileData)
    assertKnownSizeWithinLimit(body.length, MAX_BUFFERED_TRANSFER_BYTES, 'Supabase upload file')
    return {
      body,
      contentType: input.contentType || dataUrlType || 'application/octet-stream',
    }
  }

  let userFile
  try {
    userFile = processSingleFileToUserFile(input.fileData, context.requestId, logger)
  } catch (error) {
    return failureResponse(getErrorMessage(error, 'Failed to process file'), 400)
  }

  const denied = await assertToolFileAccess(userFile.key, context.userId, context.requestId, logger)
  context.signal?.throwIfAborted()
  if (denied) return denied

  try {
    const resolved = await downloadServableFileFromStorage(userFile, context.requestId, logger, {
      maxBytes: MAX_BUFFERED_TRANSFER_BYTES,
      signal: context.signal,
    })
    return {
      body: resolved.buffer,
      contentType:
        input.contentType || resolved.contentType || userFile.type || 'application/octet-stream',
    }
  } catch (error) {
    context.signal?.throwIfAborted()
    const notReady = docNotReadyResponse(error)
    if (notReady) return notReady
    return failureResponse(
      getErrorMessage(error, 'Internal server error'),
      isPayloadSizeLimitError(error) ? 413 : 500
    )
  }
}

export async function executeSupabaseStorageUpload(
  input: SupabaseStorageUploadInput,
  context: SupabaseOperationContext
): Promise<Response> {
  try {
    context.signal?.throwIfAborted()
    const projectValidation = validateSupabaseProjectId(input.projectId)
    if (!projectValidation.isValid) {
      return failureResponse(projectValidation.error || 'Invalid Supabase project ID', 400)
    }

    const upload = await resolveUploadBody(input, context)
    if (upload instanceof Response) return upload
    context.signal?.throwIfAborted()

    const fullPath = input.path
      ? `${input.path.endsWith('/') ? input.path : `${input.path}/`}${input.fileName}`
      : input.fileName
    /**
     * The storage path guards throw a plain `Error`, and the catch at the end of
     * this function maps anything that is not a payload-size failure to 500.
     * Every value they reject is caller-supplied — a `bucket` of `..`, a `path`
     * with an empty segment — so reporting it as a server fault both
     * misattributes the blame and buries the guard's named message behind a
     * generic status. 400 is the accurate answer, and it matches how
     * `validateSupabaseProjectId` above already reports a bad project id.
     */
    let encodedBucket: string
    let encodedPath: string
    try {
      encodedBucket = encodeStorageSegment(input.bucket)
      encodedPath = encodeStoragePath(fullPath)
    } catch (error) {
      return failureResponse(getErrorMessage(error, 'Invalid storage path'), 400)
    }
    const baseUrl = `https://${projectValidation.sanitized}.supabase.co/storage/v1/object`
    const headers: Record<string, string> = {
      apikey: input.apiKey,
      Authorization: `Bearer ${input.apiKey}`,
      'Content-Type': upload.contentType,
    }
    if (input.cacheControl) {
      const cacheControl = input.cacheControl.trim()
      headers['cache-control'] = /^\d+$/.test(cacheControl)
        ? `max-age=${cacheControl}`
        : cacheControl
    }
    if (input.upsert) headers['x-upsert'] = 'true'

    const response = await fetch(`${baseUrl}/${encodedBucket}/${encodedPath}`, {
      method: 'POST',
      headers,
      body: new Uint8Array(upload.body),
      signal: context.signal,
    })
    const responseText = await readResponseTextWithLimit(response, {
      maxBytes: MAX_SUPABASE_RESPONSE_BYTES,
      label: 'Supabase upload response',
      signal: context.signal,
    })
    let result: Record<string, unknown>
    try {
      const parsed: unknown = JSON.parse(responseText)
      result = parsed && typeof parsed === 'object' ? (parsed as Record<string, unknown>) : {}
    } catch {
      result = { message: responseText }
    }

    if (!response.ok) {
      const error =
        (typeof result.message === 'string' && result.message) ||
        (typeof result.error === 'string' && result.error) ||
        `Upload failed: ${response.statusText}`
      return failureResponse(error, response.status, result)
    }

    return Response.json({
      success: true,
      output: {
        message: 'Successfully uploaded file to storage',
        results: {
          ...result,
          path: fullPath,
          bucket: input.bucket,
          publicUrl: `${baseUrl}/public/${encodedBucket}/${encodedPath}`,
        },
      },
    })
  } catch (error) {
    context.signal?.throwIfAborted()
    return failureResponse(
      getErrorMessage(error, 'Internal server error'),
      isPayloadSizeLimitError(error) ? 413 : 500
    )
  }
}
