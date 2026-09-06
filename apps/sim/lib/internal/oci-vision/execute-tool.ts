import { createLogger } from '@sim/logger'
import { isPlainRecord } from '@sim/utils/object'
import { isPayloadSizeLimitError } from '@/lib/core/utils/stream-limits'
import { normalizeOciVisionError } from '@/lib/internal/oci-vision/errors'
import { executeOciVisionOperation } from '@/lib/internal/oci-vision/operations'
import { ociVisionInputSchema } from '@/lib/internal/oci-vision/schema'
import type { InternalToolOperationHandler } from '@/lib/internal/tool-operations/types'
import { OCI_VISION_MAX_JSON_BYTES, OCI_VISION_OPERATIONS } from '@/tools/oci_vision/shared'

const logger = createLogger('OciVisionToolExecution')

export const executeOciVisionTool: InternalToolOperationHandler = async (request) => {
  request.signal?.throwIfAborted()
  const operation = request.toolId.replace(/^oci_vision_/, '')
  if (
    !request.toolId.startsWith('oci_vision_') ||
    !OCI_VISION_OPERATIONS.some((value) => value === operation) ||
    !isPlainRecord(request.input) ||
    'operation' in request.input
  ) {
    return Response.json(
      { success: false, error: 'Invalid OCI Vision tool input' },
      { status: 400 }
    )
  }
  if (!request.context.workspaceId) {
    return Response.json(
      { success: false, error: 'Workspace context is required' },
      { status: 403 }
    )
  }
  try {
    if (Buffer.byteLength(JSON.stringify(request.input), 'utf8') > OCI_VISION_MAX_JSON_BYTES) {
      return Response.json(
        { success: false, error: 'OCI Vision input exceeds 8 MiB' },
        { status: 413 }
      )
    }
  } catch {
    return Response.json(
      { success: false, error: 'Invalid OCI Vision JSON input' },
      { status: 400 }
    )
  }
  const parsed = ociVisionInputSchema.safeParse({ ...request.input, operation })
  if (!parsed.success) {
    return Response.json(
      {
        success: false,
        error: 'Invalid OCI Vision input; check required fields, feature settings, and limits',
      },
      { status: 400 }
    )
  }
  try {
    const result = await executeOciVisionOperation(parsed.data, {
      ...request.context,
      workspaceId: request.context.workspaceId,
      headers: request.headers,
      requestId: request.requestId,
      signal: request.signal,
    })
    request.signal?.throwIfAborted()
    return Response.json(result)
  } catch (error) {
    request.signal?.throwIfAborted()
    const normalized = isPayloadSizeLimitError(error)
      ? { status: 413, message: 'OCI Vision data exceeds the configured size limit' }
      : normalizeOciVisionError(error)
    logger.warn('OCI Vision operation failed', {
      operation,
      requestId: request.requestId,
      status: normalized.status,
    })
    return Response.json(
      { success: false, error: normalized.message },
      { status: normalized.status }
    )
  }
}
