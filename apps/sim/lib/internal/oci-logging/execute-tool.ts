import { getValidationErrorMessage } from '@/lib/api/server'
import { DEFAULT_MAX_JSON_BODY_BYTES } from '@/lib/api/server/validation'
import { authorizeCredentialUseForAuth } from '@/lib/auth/credential-access'
import { AuthType } from '@/lib/auth/hybrid'
import { createOciClient } from '@/lib/internal/oci/client.server'
import { OciClientError } from '@/lib/internal/oci/errors'
import {
  executeOciLoggingOperation,
  OCI_LOGGING_INGESTION_POLICY,
  OCI_LOGGING_MANAGEMENT_POLICY,
  OCI_LOGGING_SERVICE_ID,
} from '@/lib/internal/oci-logging/operations'
import {
  ociLoggingCredentialSchema,
  ociLoggingInputSchemas,
} from '@/lib/internal/oci-logging/schema'
import type { InternalToolOperationHandler } from '@/lib/internal/tool-operations/types'
import type { OciLoggingOperation } from '@/tools/oci_logging/types'

export const executeOciLoggingTool: InternalToolOperationHandler = async (request) => {
  request.signal?.throwIfAborted()
  const operation = request.toolId.slice('oci_logging_'.length)
  if (
    !request.toolId.startsWith('oci_logging_') ||
    !Object.hasOwn(ociLoggingInputSchemas, operation)
  ) {
    return Response.json(
      { success: false, error: 'Unsupported OCI Logging operation' },
      { status: 400 }
    )
  }
  const { userId, workspaceId, workflowId } = request.context
  if (!userId || !workspaceId) {
    return Response.json(
      { success: false, error: 'Authenticated user and workspace context are required' },
      { status: 401 }
    )
  }
  try {
    if (Buffer.byteLength(JSON.stringify(request.input) ?? '') > DEFAULT_MAX_JSON_BODY_BYTES) {
      return Response.json(
        { success: false, error: 'OCI Logging input exceeds the request size limit' },
        { status: 413 }
      )
    }
  } catch {
    return Response.json({ success: false, error: 'Invalid OCI Logging input' }, { status: 400 })
  }
  const credential = ociLoggingCredentialSchema.safeParse(request.input)
  const input = ociLoggingInputSchemas[operation as OciLoggingOperation].safeParse(request.input)
  if (!credential.success || !input.success) {
    const error = !credential.success ? credential.error : !input.success ? input.error : undefined
    return Response.json(
      {
        success: false,
        error: error
          ? getValidationErrorMessage(error, 'Invalid OCI Logging input')
          : 'Invalid OCI Logging input',
      },
      { status: 400 }
    )
  }
  const replaySensitive =
    !operation.startsWith('list_') && !operation.startsWith('get_') && operation !== 'search_logs'
  try {
    const access = await authorizeCredentialUseForAuth(
      { success: true, userId, authType: AuthType.INTERNAL_JWT },
      {
        credentialId: credential.data.ociCredential,
        workspaceId,
        workflowId: workflowId || undefined,
        callerUserId: userId,
      }
    )
    request.signal?.throwIfAborted()
    if (
      !access.ok ||
      access.credentialType !== 'service_account' ||
      !access.resolvedCredentialId ||
      access.workspaceId !== workspaceId
    ) {
      return Response.json(
        { success: false, error: 'OCI credential is unavailable in this workspace' },
        { status: 403 }
      )
    }
    const client = await createOciClient({
      credentialId: access.resolvedCredentialId,
      workspaceId,
      serviceId: OCI_LOGGING_SERVICE_ID,
      region: credential.data.region,
    })
    request.signal?.throwIfAborted()
    const endpoint = await client.prepareStaticEndpoint(
      operation === 'put_logs' ? OCI_LOGGING_INGESTION_POLICY : OCI_LOGGING_MANAGEMENT_POLICY
    )
    request.signal?.throwIfAborted()
    const output = await executeOciLoggingOperation(
      operation as OciLoggingOperation,
      input.data,
      { client, endpoint },
      request.signal
    )
    return Response.json({ success: true, output })
  } catch (error) {
    request.signal?.throwIfAborted()
    return Response.json(
      {
        success: false,
        error: error instanceof OciClientError ? error.message : 'OCI Logging operation failed',
        ...(error instanceof OciClientError && error.opcRequestId
          ? { opcRequestId: error.opcRequestId }
          : {}),
        ...(replaySensitive ? { retryable: false } : {}),
      },
      { status: error instanceof OciClientError && error.status === 429 ? 429 : 502 }
    )
  }
}
