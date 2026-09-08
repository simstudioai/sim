import { OciClientError } from '@/lib/internal/oci/errors'
import {
  executeOciDevopsOperation,
  OciDevopsError,
  operationDefinitions,
} from '@/lib/internal/oci-devops/operations'
import type { InternalToolOperationHandler } from '@/lib/internal/tool-operations/types'
import type { OciDevopsAction } from '@/tools/oci_devops/types'

export const executeOciDevopsTool: InternalToolOperationHandler = async (request) => {
  const action = request.toolId.replace(/^oci_devops_/, '')
  if (!request.toolId.startsWith('oci_devops_') || !Object.hasOwn(operationDefinitions, action)) {
    return Response.json(
      { success: false, error: 'Unsupported OCI DevOps operation' },
      { status: 400 }
    )
  }
  try {
    return Response.json(
      await executeOciDevopsOperation(
        action as OciDevopsAction,
        request.input,
        request.context,
        request.signal
      )
    )
  } catch (error) {
    request.signal?.throwIfAborted()
    const known = error instanceof OciClientError || error instanceof OciDevopsError
    return Response.json(
      {
        success: false,
        error: known ? error.message : 'OCI DevOps operation failed',
        ...(error instanceof OciClientError
          ? { output: { requestId: error.opcRequestId, code: error.code } }
          : {}),
      },
      { status: known ? (error.status ?? 502) : 500 }
    )
  }
}
