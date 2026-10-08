import { resolvePrincipalSubject } from '@sim/auth/principal'
import { createLogger } from '@sim/logger'
import type { ZodError } from 'zod'
import { getValidationErrorMessage } from '@/lib/api/server'
import { normalizeOciObjectStorageError } from '@/lib/internal/oci-object-storage/errors'
import {
  executeOciObjectStorageDeleteObject,
  executeOciObjectStorageDownloadObject,
  executeOciObjectStorageHeadObject,
  executeOciObjectStorageListBuckets,
  executeOciObjectStorageListObjects,
  executeOciObjectStorageUploadObject,
  type OciObjectStorageOperationContext,
} from '@/lib/internal/oci-object-storage/operations'
import {
  ociObjectStorageDeleteObjectInputSchema,
  ociObjectStorageDownloadObjectInputSchema,
  ociObjectStorageHeadObjectInputSchema,
  ociObjectStorageListBucketsInputSchema,
  ociObjectStorageListObjectsInputSchema,
  ociObjectStorageUploadObjectInputSchema,
} from '@/lib/internal/oci-object-storage/schema'
import { createExecutorPrincipalFromExecutionContext } from '@/lib/internal/principals/executor'
import { isInternalToolFileResult } from '@/lib/internal/tool-operations/file-result'
import type {
  InternalToolOperationCall,
  InternalToolOperationHandler,
  InternalToolOperationResult,
} from '@/lib/internal/tool-operations/types'
import { WORKSPACE_FILES_DELEGATION_AUDIENCE } from '@/lib/workspace-files/application/authorization'

const logger = createLogger('OciObjectStorageToolExecution')

function invalidInput(error: ZodError): Response {
  return Response.json(
    { success: false, error: getValidationErrorMessage(error, 'Invalid request data') },
    { status: 400 }
  )
}

async function dispatch(request: InternalToolOperationCall): Promise<unknown> {
  switch (request.toolId) {
    case 'oci_object_storage_list_buckets': {
      const parsed = ociObjectStorageListBucketsInputSchema.safeParse(request.input)
      if (!parsed.success) return invalidInput(parsed.error)
      return executeOciObjectStorageListBuckets(parsed.data, request.signal)
    }
    case 'oci_object_storage_list_objects': {
      const parsed = ociObjectStorageListObjectsInputSchema.safeParse(request.input)
      if (!parsed.success) return invalidInput(parsed.error)
      return executeOciObjectStorageListObjects(parsed.data, request.signal)
    }
    case 'oci_object_storage_upload_object': {
      const parsed = ociObjectStorageUploadObjectInputSchema.safeParse(request.input)
      if (!parsed.success) return invalidInput(parsed.error)
      const principal =
        parsed.data.file && request.context.executorDelegationOrigin
          ? await createExecutorPrincipalFromExecutionContext({
              context: request.context,
              audience: WORKSPACE_FILES_DELEGATION_AUDIENCE,
            })
          : request.context.callerPrincipal
      const subject = principal ? resolvePrincipalSubject(principal) : null
      const context: OciObjectStorageOperationContext = {
        principal,
        userId: principal
          ? subject?.kind === 'sim_user'
            ? subject.userId
            : undefined
          : request.context.userId,
        workspaceId: request.context.workspaceId,
        workflowId: request.context.workflowId,
        executionId: request.context.executionId,
        largeValueExecutionIds: request.context.largeValueExecutionIds,
        largeValueKeys: request.context.largeValueKeys,
        fileKeys: request.context.fileKeys,
        allowLargeValueWorkflowScope: request.context.allowLargeValueWorkflowScope,
        requestId: request.requestId,
        signal: request.signal,
      }
      return executeOciObjectStorageUploadObject(parsed.data, context)
    }
    case 'oci_object_storage_download_object': {
      const parsed = ociObjectStorageDownloadObjectInputSchema.safeParse(request.input)
      if (!parsed.success) return invalidInput(parsed.error)
      return executeOciObjectStorageDownloadObject(parsed.data, request.signal)
    }
    case 'oci_object_storage_head_object': {
      const parsed = ociObjectStorageHeadObjectInputSchema.safeParse(request.input)
      if (!parsed.success) return invalidInput(parsed.error)
      return executeOciObjectStorageHeadObject(parsed.data, request.signal)
    }
    case 'oci_object_storage_delete_object': {
      const parsed = ociObjectStorageDeleteObjectInputSchema.safeParse(request.input)
      if (!parsed.success) return invalidInput(parsed.error)
      return executeOciObjectStorageDeleteObject(parsed.data, request.signal)
    }
    default:
      return Response.json(
        { success: false, error: `Unsupported OCI Object Storage tool: ${request.toolId}` },
        { status: 500 }
      )
  }
}

export const executeOciObjectStorageTool: InternalToolOperationHandler<
  InternalToolOperationResult
> = async (request) => {
  request.signal?.throwIfAborted()
  try {
    const result = await dispatch(request)
    if (result instanceof Response || isInternalToolFileResult(result)) return result
    request.signal?.throwIfAborted()
    return Response.json(result)
  } catch (error) {
    request.signal?.throwIfAborted()
    const normalized = normalizeOciObjectStorageError(error)
    const logContext = {
      requestId: request.requestId,
      toolId: request.toolId,
      status: normalized.status,
    }
    if (normalized.status >= 500) {
      logger.error('OCI Object Storage operation failed', logContext)
    } else {
      logger.warn('OCI Object Storage operation failed', logContext)
    }
    return Response.json(
      { success: false, error: normalized.message },
      { status: normalized.status }
    )
  }
}
