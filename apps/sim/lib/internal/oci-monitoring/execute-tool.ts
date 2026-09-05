import { authorizeCredentialUseForAuth } from '@/lib/auth/credential-access'
import { AuthType } from '@/lib/auth/hybrid'
import { createOciClient } from '@/lib/internal/oci/client.server'
import { OciClientError } from '@/lib/internal/oci/errors'
import {
  type OciMonitoringOperation,
  ociMonitoringInputSchemas,
} from '@/lib/internal/oci-monitoring/input'
import {
  executeOciMonitoringOperation,
  OciMonitoringInputError,
} from '@/lib/internal/oci-monitoring/operations'
import type { InternalToolOperationHandler } from '@/lib/internal/tool-operations/types'

export const executeOciMonitoringTool: InternalToolOperationHandler = async (request) => {
  request.signal?.throwIfAborted()
  const operation = request.toolId.slice('oci_monitoring_'.length)
  if (
    !request.toolId.startsWith('oci_monitoring_') ||
    !Object.hasOwn(ociMonitoringInputSchemas, operation)
  ) {
    return Response.json(
      { success: false, error: 'Unsupported OCI Monitoring operation' },
      { status: 400 }
    )
  }
  const parsed = ociMonitoringInputSchemas[operation as OciMonitoringOperation].safeParse(
    request.input
  )
  if (!parsed.success) {
    return Response.json(
      {
        success: false,
        retryable: false,
        error: 'Invalid OCI Monitoring input',
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
        error: 'OCI Monitoring requires authenticated workspace context',
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
      serviceId: 'oci_monitoring',
      region: parsed.data.region,
    })
    const result = await executeOciMonitoringOperation(
      client,
      operation as OciMonitoringOperation,
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
            'OCI Monitoring exceeded the 8 MiB response budget; narrow the MQL, time range, filters or page size',
          output: { opcRequestId: error.opcRequestId ?? null },
        },
        { status: 413 }
      )
    }
    const status =
      error instanceof OciMonitoringInputError
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
        retryable: operation === 'post_metric_data' ? false : status === 429 || status >= 500,
        error:
          error instanceof OciClientError || error instanceof OciMonitoringInputError
            ? error.message
            : 'OCI Monitoring request failed',
        output: {
          opcRequestId: error instanceof OciClientError ? (error.opcRequestId ?? null) : null,
        },
      },
      { status }
    )
  }
}
