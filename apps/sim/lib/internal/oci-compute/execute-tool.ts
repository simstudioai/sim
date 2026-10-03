import { getErrorMessage } from '@sim/utils/errors'
import { getValidationErrorMessage } from '@/lib/api/server'
import { DEFAULT_MAX_JSON_BODY_BYTES } from '@/lib/api/server/validation'
import { authorizeCredentialUseForAuth } from '@/lib/auth/credential-access'
import { AuthType } from '@/lib/auth/hybrid'
import { createOciClient } from '@/lib/internal/oci/client.server'
import { executeOciComputeOperation } from '@/lib/internal/oci-compute/operations'
import { type OciComputeOperation, ociComputeSchemas } from '@/lib/internal/oci-compute/schema'
import type { InternalToolOperationHandler } from '@/lib/internal/tool-operations/types'
import { OCI_COMPUTE_SERVICE_ID } from '@/tools/oci_compute/types'

export const executeOciComputeTool: InternalToolOperationHandler = async (request) => {
  request.signal?.throwIfAborted()
  if (!request.toolId.startsWith('oci_compute_')) {
    return Response.json({ success: false, error: 'Unsupported OCI Compute tool' }, { status: 400 })
  }
  const operation = request.toolId.slice('oci_compute_'.length)
  if (!Object.hasOwn(ociComputeSchemas, operation)) {
    return Response.json(
      { success: false, error: 'Unsupported OCI Compute operation' },
      { status: 400 }
    )
  }
  const { userId, workspaceId, workflowId } = request.context
  if (!userId || !workspaceId) {
    return Response.json(
      { success: false, error: 'Trusted execution scope is required' },
      { status: 401 }
    )
  }
  try {
    if (Buffer.byteLength(JSON.stringify(request.input) ?? '') > DEFAULT_MAX_JSON_BODY_BYTES) {
      return Response.json(
        { success: false, error: 'OCI Compute input is too large' },
        { status: 413 }
      )
    }
  } catch {
    return Response.json({ success: false, error: 'Invalid OCI Compute input' }, { status: 400 })
  }
  const key = operation as OciComputeOperation
  const parsed = ociComputeSchemas[key].safeParse(request.input)
  if (!parsed.success) {
    return Response.json(
      {
        success: false,
        error: getValidationErrorMessage(parsed.error, 'Invalid OCI Compute input'),
      },
      { status: 400 }
    )
  }
  try {
    const access = await authorizeCredentialUseForAuth(
      { success: true, authType: AuthType.INTERNAL_JWT, userId },
      {
        credentialId: parsed.data.oauthCredential,
        workspaceId,
        workflowId: workflowId || undefined,
        callerUserId: userId,
      }
    )
    if (
      !access.ok ||
      !access.resolvedCredentialId ||
      access.credentialType !== 'service_account' ||
      access.workspaceId !== workspaceId
    ) {
      return Response.json(
        { success: false, error: 'An authorized OCI service-account credential is required' },
        { status: 403 }
      )
    }
    request.signal?.throwIfAborted()
    const client = await createOciClient({
      credentialId: access.resolvedCredentialId,
      workspaceId,
      serviceId: OCI_COMPUTE_SERVICE_ID,
      region: parsed.data.region,
    })
    return Response.json(await executeOciComputeOperation(client, key, parsed.data, request.signal))
  } catch (error) {
    request.signal?.throwIfAborted()
    return Response.json(
      { success: false, error: getErrorMessage(error, 'OCI Compute authorization failed') },
      { status: 500 }
    )
  }
}
