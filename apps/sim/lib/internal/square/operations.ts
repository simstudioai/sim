import { createLogger } from '@sim/logger'
import { getErrorMessage } from '@sim/utils/errors'
import { generateId } from '@sim/utils/id'
import {
  readResponseJsonWithLimit,
  readResponseTextWithLimit,
} from '@/lib/core/utils/stream-limits'
import type { SquareCatalogImageInput } from '@/lib/internal/square/schema'
import { MAX_BUFFERED_TRANSFER_BYTES } from '@/lib/uploads/shared/types'
import { processFilesToUserFiles } from '@/lib/uploads/utils/file-utils'
import { downloadFileFromStorage } from '@/lib/uploads/utils/file-utils.server'
import { assertToolFileAccess } from '@/app/api/files/authorization'
import { SQUARE_API_VERSION, SQUARE_BASE_URL } from '@/tools/square/types'

const logger = createLogger('SquareCatalogImage')
const MAX_SQUARE_RESPONSE_BYTES = 10 * 1024 * 1024

export interface SquareOperationContext {
  userId: string
  requestId: string
  signal?: AbortSignal
}

function failureResponse(error: string, status: number): Response {
  return Response.json({ success: false, error }, { status })
}

export async function executeSquareCreateCatalogImage(
  input: SquareCatalogImageInput,
  context: SquareOperationContext
): Promise<Response> {
  try {
    context.signal?.throwIfAborted()
    if (!input.file) return failureResponse('File is required', 400)
    if (typeof input.file === 'string') return failureResponse('Invalid file input', 400)

    const userFile = processFilesToUserFiles([input.file], context.requestId, logger)[0]
    if (!userFile) return failureResponse('Invalid file input', 400)

    const denied = await assertToolFileAccess(
      userFile.key,
      context.userId,
      context.requestId,
      logger
    )
    context.signal?.throwIfAborted()
    if (denied) return denied

    const fileBuffer = await downloadFileFromStorage(userFile, context.requestId, logger, {
      maxBytes: MAX_BUFFERED_TRANSFER_BYTES,
    })
    context.signal?.throwIfAborted()

    const imageRequest: Record<string, unknown> = {
      idempotency_key: input.idempotencyKey || generateId(),
      image: {
        type: 'IMAGE',
        id: '#square_catalog_image',
        image_data: input.caption ? { caption: input.caption } : {},
      },
    }
    if (input.objectId) imageRequest.object_id = input.objectId

    const formData = new FormData()
    formData.append('request', JSON.stringify(imageRequest))
    formData.append(
      'file',
      new Blob([new Uint8Array(fileBuffer)], {
        type: userFile.type || 'application/octet-stream',
      }),
      input.fileName || userFile.name
    )

    const response = await fetch(`${SQUARE_BASE_URL}/v2/catalog/images`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${input.accessToken}`,
        'Square-Version': SQUARE_API_VERSION,
      },
      body: formData,
      signal: context.signal,
    })

    if (!response.ok) {
      const errorText = await readResponseTextWithLimit(response, {
        maxBytes: MAX_SQUARE_RESPONSE_BYTES,
        label: 'Square error response',
        signal: context.signal,
      })
      let detail: string | undefined
      try {
        const parsed = JSON.parse(errorText) as { errors?: Array<{ detail?: string }> }
        detail = parsed.errors?.[0]?.detail
      } catch {
        detail = undefined
      }
      return failureResponse(
        detail || `Failed to upload catalog image (HTTP ${response.status})`,
        response.status
      )
    }

    const data = await readResponseJsonWithLimit<{ image?: Record<string, unknown> }>(response, {
      maxBytes: MAX_SQUARE_RESPONSE_BYTES,
      label: 'Square catalog image response',
      signal: context.signal,
    })
    const object = data.image ?? {}
    return Response.json({
      success: true,
      output: {
        object,
        metadata: {
          id: typeof object.id === 'string' ? object.id : '',
          type: typeof object.type === 'string' ? object.type : null,
          version: typeof object.version === 'number' ? object.version : null,
        },
      },
    })
  } catch (error) {
    context.signal?.throwIfAborted()
    logger.error(`[${context.requestId}] Square catalog image upload failed`, {
      error: getErrorMessage(error),
    })
    return failureResponse(getErrorMessage(error, 'Unknown error'), 500)
  }
}
