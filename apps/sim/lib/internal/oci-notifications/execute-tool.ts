import { isPlainRecord } from '@sim/utils/object'
import { DEFAULT_MAX_JSON_BODY_BYTES } from '@/lib/api/server/validation'
import { authorizeCredentialUseForAuth } from '@/lib/auth/credential-access'
import { AuthType } from '@/lib/auth/hybrid'
import { createOciClient } from '@/lib/internal/oci/client.server'
import { OciClientError } from '@/lib/internal/oci/errors'
import { prepareOciNotificationsClient } from '@/lib/internal/oci-notifications/endpoints'
import {
  executeOciNotificationsOperation,
  OciNotificationsOperationError,
} from '@/lib/internal/oci-notifications/operations'
import { ociNotificationsInputSchema } from '@/lib/internal/oci-notifications/schema'
import type { InternalToolOperationHandler } from '@/lib/internal/tool-operations/types'

function failure(error: string, status: number, requestId?: string): Response {
  return Response.json(
    { success: false, error, output: { status, requestId }, retryable: false },
    { status }
  )
}

export const executeOciNotificationsTool: InternalToolOperationHandler = async ({
  toolId,
  input,
  context,
  signal,
}) => {
  signal?.throwIfAborted()
  if (!context.userId || !context.workspaceId) return failure('Authentication required', 401)
  if (!isPlainRecord(input)) return failure('Invalid OCI Notifications input', 400)
  let serializedInput: string
  try {
    serializedInput = JSON.stringify(input)
  } catch {
    return failure('Invalid OCI Notifications input', 400)
  }
  if (Buffer.byteLength(serializedInput, 'utf8') > DEFAULT_MAX_JSON_BODY_BYTES) {
    return failure('OCI Notifications input exceeds the application request size limit', 413)
  }
  const parsed = ociNotificationsInputSchema.safeParse({ ...input, operation: toolId })
  if (!parsed.success) {
    return failure(parsed.error.issues[0]?.message ?? 'Invalid OCI Notifications input', 400)
  }

  try {
    const access = await authorizeCredentialUseForAuth(
      { success: true, userId: context.userId, authType: AuthType.INTERNAL_JWT },
      {
        credentialId: parsed.data.oauthCredential,
        workspaceId: context.workspaceId,
        workflowId: context.workflowId || undefined,
        callerUserId: context.userId,
      }
    )
    if (
      !access.ok ||
      access.credentialType !== 'service_account' ||
      !access.resolvedCredentialId ||
      access.workspaceId !== context.workspaceId
    ) {
      return failure('OCI Notifications credential is unavailable', 401)
    }
    signal?.throwIfAborted()
    const client = await createOciClient({
      credentialId: access.resolvedCredentialId,
      workspaceId: context.workspaceId,
      serviceId: 'oci-notifications',
      region: parsed.data.region,
    })
    const prepared = await prepareOciNotificationsClient(client)
    const output = await executeOciNotificationsOperation(parsed.data, prepared, signal)
    return Response.json({ success: true, output })
  } catch (error) {
    signal?.throwIfAborted()
    if (error instanceof OciNotificationsOperationError)
      return failure(error.message, error.status, error.requestId)
    if (error instanceof OciClientError) {
      const status =
        error.code === 'credential_unavailable'
          ? 401
          : error.code === 'invalid_request' || error.code === 'invalid_endpoint'
            ? 400
            : error.code === 'deadline_exceeded'
              ? 504
              : error.status && error.status >= 400
                ? error.status
                : 502
      return failure(error.message, status, error.opcRequestId)
    }
    return failure('OCI Notifications operation failed', 500)
  }
}
