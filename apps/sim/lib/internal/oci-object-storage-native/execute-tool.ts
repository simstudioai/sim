import { createLogger } from '@sim/logger'
import { isPlainRecord } from '@sim/utils/object'
import { getValidationErrorMessage } from '@/lib/api/server'
import { normalizeOciNativeError } from '@/lib/internal/oci-object-storage-native/errors'
import { executeOciNativeOperation } from '@/lib/internal/oci-object-storage-native/operations'
import { ociNativeInputSchema } from '@/lib/internal/oci-object-storage-native/schema'
import type { InternalToolOperationHandler } from '@/lib/internal/tool-operations/types'
import {
  isOciNativeJsonWithinLimit,
  OCI_NATIVE_JSON_BYTES,
} from '@/tools/oci_object_storage_native/shared'

const logger = createLogger('OciObjectStorageNativeToolExecution')
const PREFIX = 'oci_object_storage_native_'

export const executeOciObjectStorageNativeTool: InternalToolOperationHandler = async (request) => {
  request.signal?.throwIfAborted()
  if (
    !request.toolId.startsWith(PREFIX) ||
    !isPlainRecord(request.input) ||
    'operation' in request.input
  ) {
    return Response.json(
      { success: false, error: 'Invalid native OCI tool input' },
      { status: 400 }
    )
  }
  try {
    if (!isOciNativeJsonWithinLimit(request.input, OCI_NATIVE_JSON_BYTES)) {
      return Response.json(
        {
          success: false,
          error: 'OCI request exceeds 8 MiB of JSON; use a file for larger uploads',
        },
        { status: 413 }
      )
    }
  } catch {
    return Response.json(
      { success: false, error: 'Invalid or excessively nested OCI JSON input' },
      { status: 400 }
    )
  }
  const parsed = ociNativeInputSchema.safeParse({
    ...request.input,
    operation: request.toolId.slice(PREFIX.length),
  })
  if (!parsed.success)
    return Response.json(
      {
        success: false,
        error: getValidationErrorMessage(parsed.error, 'Invalid native OCI request'),
      },
      { status: 400 }
    )
  if (!request.context.workspaceId)
    return Response.json(
      { success: false, error: 'Workspace context is required' },
      { status: 403 }
    )
  try {
    const result = await executeOciNativeOperation(parsed.data, {
      workspaceId: request.context.workspaceId,
      workflowId: request.context.workflowId,
      executionId: request.context.executionId,
      userId: request.context.executorDelegationOrigin?.subjectUserId ?? request.context.userId,
      requestId: request.requestId,
      signal: request.signal,
    })
    request.signal?.throwIfAborted()
    return Response.json(result)
  } catch (error) {
    request.signal?.throwIfAborted()
    const normalized = normalizeOciNativeError(error)
    logger.warn('Native OCI operation failed', {
      requestId: request.requestId,
      toolId: request.toolId,
      status: normalized.status,
    })
    return Response.json(
      { success: false, error: normalized.message },
      { status: normalized.status }
    )
  }
}
