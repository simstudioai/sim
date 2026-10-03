import { authorizeCredentialUseForAuth } from '@/lib/auth/credential-access'
import { AuthType } from '@/lib/auth/hybrid'
import { createOciClient } from '@/lib/internal/oci/client.server'
import { OciClientError } from '@/lib/internal/oci/errors'
import { type OciEventsOperation, ociEventsInputSchemas } from '@/lib/internal/oci-events/input'
import {
  executeOciEventsOperation,
  OciEventsInputError,
} from '@/lib/internal/oci-events/operations'
import type { InternalToolOperationHandler } from '@/lib/internal/tool-operations/types'

export const executeOciEventsTool: InternalToolOperationHandler = async (request) => {
  request.signal?.throwIfAborted()
  const operation = request.toolId.slice('oci_events_'.length)
  if (
    !request.toolId.startsWith('oci_events_') ||
    !Object.hasOwn(ociEventsInputSchemas, operation)
  ) {
    return Response.json(
      { success: false, error: 'Unsupported OCI Events operation' },
      { status: 400 }
    )
  }
  const parsed = ociEventsInputSchemas[operation as OciEventsOperation].safeParse(request.input)
  if (!parsed.success) {
    return Response.json(
      {
        success: false,
        retryable: false,
        error: 'Invalid OCI Events input',
        details: parsed.error.issues.map((issue) => ({
          path: issue.path,
          message: issue.message,
        })),
      },
      { status: 400 }
    )
  }
  const { userId, workspaceId, workflowId } = request.context
  if (!userId || !workspaceId) {
    return Response.json(
      {
        success: false,
        retryable: false,
        error: 'OCI Events requires authenticated workspace context',
      },
      { status: 403 }
    )
  }
  try {
    const access = await authorizeCredentialUseForAuth(
      { success: true, userId, authType: AuthType.INTERNAL_JWT },
      {
        credentialId: parsed.data.oauthCredential,
        workspaceId,
        workflowId: workflowId || undefined,
        callerUserId: userId,
      }
    )
    if (!access.ok || !access.resolvedCredentialId || access.credentialType !== 'service_account') {
      return Response.json(
        { success: false, retryable: false, error: 'OCI credential is unavailable' },
        { status: 403 }
      )
    }
    request.signal?.throwIfAborted()
    const client = await createOciClient({
      credentialId: access.resolvedCredentialId,
      workspaceId,
      serviceId: 'oci_events',
      region: parsed.data.region,
    })
    const result = await executeOciEventsOperation(
      client,
      operation as OciEventsOperation,
      parsed.data,
      request.signal
    )
    return Response.json(result)
  } catch (error) {
    request.signal?.throwIfAborted()
    if (error instanceof OciClientError && error.code === 'response_too_large') {
      return Response.json(
        {
          success: false,
          retryable: false,
          error:
            'OCI Events exceeded the 8 MiB response budget; reduce the page size or narrow the rule filters',
          output: { opcRequestId: error.opcRequestId ?? null },
        },
        { status: 413 }
      )
    }
    const status =
      error instanceof OciEventsInputError
        ? 400
        : error instanceof OciClientError
          ? error.code === 'credential_unavailable'
            ? 403
            : error.code === 'invalid_request' || error.code === 'invalid_endpoint'
              ? 400
              : (error.status ?? 502)
          : 502
    return Response.json(
      {
        success: false,
        retryable:
          (operation === 'list_rules' || operation === 'get_rule') &&
          (status === 429 || status >= 500),
        error:
          error instanceof OciClientError || error instanceof OciEventsInputError
            ? error.message
            : 'OCI Events request failed',
        output: {
          opcRequestId: error instanceof OciClientError ? (error.opcRequestId ?? null) : null,
        },
      },
      { status }
    )
  }
}
