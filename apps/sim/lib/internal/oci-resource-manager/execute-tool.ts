import { getErrorMessage } from '@sim/utils/errors'
import { authorizeCredentialUseForAuth } from '@/lib/auth/credential-access'
import { AuthType } from '@/lib/auth/hybrid'
import { OciClientError } from '@/lib/internal/oci/errors'
import {
  OciResourceManagerError,
  prepareOciResourceManagerClient,
} from '@/lib/internal/oci-resource-manager/client'
import {
  type OciResourceManagerOperation,
  ociResourceManagerInputSchemas,
  parseOciResourceManagerInput,
} from '@/lib/internal/oci-resource-manager/input'
import {
  executeOciResourceManagerOperation,
  OCI_RESOURCE_MANAGER_MUTATIONS,
} from '@/lib/internal/oci-resource-manager/operations'
import type { InternalToolOperationHandler } from '@/lib/internal/tool-operations/types'

export const executeOciResourceManagerTool: InternalToolOperationHandler = async (request) => {
  const operation = request.toolId.replace(
    /^oci_resource_manager_/,
    ''
  ) as OciResourceManagerOperation
  if (!Object.hasOwn(ociResourceManagerInputSchemas, operation))
    return Response.json(
      { success: false, error: 'Unknown OCI Resource Manager operation' },
      { status: 400 }
    )
  const retryable = OCI_RESOURCE_MANAGER_MUTATIONS.has(operation) ? false : undefined
  try {
    request.signal?.throwIfAborted()
    let input: ReturnType<typeof parseOciResourceManagerInput>
    try {
      input = parseOciResourceManagerInput(operation, request.input)
    } catch (error) {
      return Response.json(
        {
          success: false,
          error: getErrorMessage(error, 'Invalid parameters'),
          retryable,
        },
        { status: 400 }
      )
    }
    const { context } = request
    if (!context.userId || !context.workspaceId)
      return Response.json(
        { success: false, error: 'Trusted user and workspace context are required', retryable },
        { status: 403 }
      )
    const access = await authorizeCredentialUseForAuth(
      { success: true, userId: context.userId, authType: AuthType.INTERNAL_JWT },
      {
        credentialId: input.oauthCredential,
        workflowId: context.workflowId || undefined,
        workspaceId: context.workspaceId,
        callerUserId: context.userId,
      }
    )
    if (
      !access.ok ||
      !access.resolvedCredentialId ||
      access.credentialType !== 'service_account' ||
      access.workspaceId !== context.workspaceId
    )
      return Response.json(
        { success: false, error: 'OCI credential is unavailable in this workspace', retryable },
        { status: 403 }
      )
    request.signal?.throwIfAborted()
    const prepared = await prepareOciResourceManagerClient({
      credentialId: access.resolvedCredentialId,
      workspaceId: context.workspaceId,
      region: input.region,
    })
    const result = await executeOciResourceManagerOperation(operation, input, {
      prepared,
      userId: context.userId,
      workspaceId: context.workspaceId,
      workflowId: context.workflowId,
      executionId: context.executionId,
      requestId: request.requestId,
      signal: request.signal,
    })
    return Response.json(result)
  } catch (error) {
    if (error instanceof OciClientError)
      return Response.json(
        {
          success: false,
          error: error.message,
          code: error.code,
          status: error.status,
          opcRequestId: error.opcRequestId,
          retryable,
        },
        { status: error.status ?? 502 }
      )
    if (error instanceof OciResourceManagerError)
      return Response.json(
        { success: false, error: error.message, retryable },
        { status: error.status }
      )
    return Response.json(
      {
        success: false,
        error:
          'OCI Resource Manager operation failed; inspect existing jobs before repeating a submission',
        retryable,
      },
      { status: 500 }
    )
  }
}
