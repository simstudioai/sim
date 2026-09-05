import { getErrorMessage } from '@sim/utils/errors'
import { authorizeCredentialUseForAuth } from '@/lib/auth/credential-access'
import { AuthType } from '@/lib/auth/hybrid'
import { createOciClient } from '@/lib/internal/oci/client.server'
import { OciClientError } from '@/lib/internal/oci/errors'
import {
  awaitOciStreaming,
  executeOciStreamingOperation,
  OCI_STREAMING_ADMIN_ENDPOINT,
  OCI_STREAMING_SERVICE_ID,
  withOciStreamingBudget,
} from '@/lib/internal/oci-streaming/operations'
import { ociStreamingInputSchema } from '@/lib/internal/oci-streaming/schema'
import type { InternalToolOperationHandler } from '@/lib/internal/tool-operations/types'

export const executeOciStreamingTool: InternalToolOperationHandler = async (request) => {
  const parsed = ociStreamingInputSchema.safeParse(request.input)
  if (!parsed.success) {
    return Response.json(
      { success: false, error: parsed.error.issues.map((issue) => issue.message).join('; ') },
      { status: 400 }
    )
  }
  const input = parsed.data
  if (request.toolId !== `oci_streaming_${input.operation}`) {
    return Response.json(
      { success: false, error: 'OCI Streaming operation does not match tool' },
      { status: 400 }
    )
  }
  const { userId, workspaceId, workflowId } = request.context
  if (!userId || !workspaceId) {
    return Response.json(
      { success: false, error: 'Trusted user and workspace context are required' },
      { status: 401 }
    )
  }
  try {
    return await withOciStreamingBudget(async (budget) => {
      const access = await awaitOciStreaming(
        authorizeCredentialUseForAuth(
          { success: true, userId, authType: AuthType.INTERNAL_JWT },
          {
            credentialId: input.ociCredential,
            workspaceId,
            workflowId: workflowId || undefined,
            callerUserId: userId,
          }
        ),
        budget.signal
      )
      if (
        !access.ok ||
        access.credentialType !== 'service_account' ||
        !access.resolvedCredentialId ||
        access.workspaceId !== workspaceId
      ) {
        return Response.json(
          { success: false, error: 'OCI service account is not accessible in this workspace' },
          { status: 403 }
        )
      }
      budget.signal.throwIfAborted()
      const client = await awaitOciStreaming(
        createOciClient({
          credentialId: access.resolvedCredentialId,
          workspaceId,
          serviceId: OCI_STREAMING_SERVICE_ID,
          region: input.ociRegion,
        }),
        budget.signal
      )
      budget.signal.throwIfAborted()
      const endpoint = await awaitOciStreaming(
        client.prepareStaticEndpoint(OCI_STREAMING_ADMIN_ENDPOINT),
        budget.signal
      )
      budget.signal.throwIfAborted()
      const result = await executeOciStreamingOperation(input, { client, endpoint }, budget)
      return Response.json(result)
    }, request.signal)
  } catch (error) {
    if (error instanceof OciClientError) {
      return Response.json(
        {
          success: false,
          error: error.message,
          output: {
            status: error.status ?? null,
            requestId: error.opcRequestId ?? null,
            code: error.code,
          },
        },
        { status: error.status && error.status >= 400 ? error.status : 502 }
      )
    }
    return Response.json(
      { success: false, error: getErrorMessage(error, 'OCI Streaming operation failed') },
      { status: 400 }
    )
  }
}
