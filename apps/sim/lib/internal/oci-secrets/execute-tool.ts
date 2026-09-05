import { isPlainRecord } from '@sim/utils/object'
import { DEFAULT_MAX_JSON_BODY_BYTES } from '@/lib/api/server/validation'
import { authorizeCredentialUseForAuth } from '@/lib/auth/credential-access'
import { AuthType } from '@/lib/auth/hybrid'
import { createOciClient } from '@/lib/internal/oci/client.server'
import { OciClientError } from '@/lib/internal/oci/errors'
import { ociSecretsInputSchema } from '@/lib/internal/oci-secrets/input'
import { executeOciSecretsOperation } from '@/lib/internal/oci-secrets/operations'
import type { InternalToolOperationHandler } from '@/lib/internal/tool-operations/types'

export const executeOciSecretsTool: InternalToolOperationHandler = async (request) => {
  request.signal?.throwIfAborted()
  if (!request.toolId.startsWith('oci_secrets_')) {
    return Response.json({ error: 'Unsupported OCI Secrets tool' }, { status: 400 })
  }
  const { userId, workspaceId, workflowId } = request.context
  if (!userId || !workspaceId) {
    return Response.json(
      { error: 'Trusted user and workspace context are required' },
      { status: 401 }
    )
  }
  if (!isPlainRecord(request.input)) {
    return Response.json({ error: 'Invalid OCI Secrets input' }, { status: 400 })
  }
  let serialized: string
  try {
    serialized = JSON.stringify(request.input)
  } catch {
    return Response.json({ error: 'Invalid OCI Secrets input' }, { status: 400 })
  }
  if (Buffer.byteLength(serialized, 'utf8') > DEFAULT_MAX_JSON_BODY_BYTES) {
    return Response.json({ error: 'OCI Secrets input exceeds the allowed size' }, { status: 413 })
  }
  const parsed = ociSecretsInputSchema.safeParse({
    ...request.input,
    operation: request.toolId.slice('oci_secrets_'.length),
  })
  if (!parsed.success) {
    return Response.json(
      {
        error: 'Invalid OCI Secrets input',
        details: parsed.error.issues.map(({ path, message }) => ({ path, message })),
      },
      { status: 400 }
    )
  }
  try {
    const access = await authorizeCredentialUseForAuth(
      {
        success: true,
        userId,
        authType: AuthType.INTERNAL_JWT,
      },
      {
        credentialId: parsed.data.accessToken ?? parsed.data.oauthCredential,
        callerUserId: userId,
        workspaceId,
        workflowId: workflowId || undefined,
      }
    )
    if (
      !access.ok ||
      access.credentialType !== 'service_account' ||
      !access.resolvedCredentialId ||
      access.workspaceId !== workspaceId
    ) {
      return Response.json({ error: 'OCI credential is unavailable' }, { status: 403 })
    }
    request.signal?.throwIfAborted()
    const client = await createOciClient({
      credentialId: access.resolvedCredentialId,
      workspaceId,
      serviceId: 'oci_secrets',
      region: parsed.data.region,
    })
    return Response.json(await executeOciSecretsOperation(client, parsed.data, request.signal))
  } catch (error) {
    request.signal?.throwIfAborted()
    const failure = error instanceof OciClientError ? error : new OciClientError('request_failed')
    return Response.json({
      success: false,
      error: failure.message,
      retryable: false,
      output: { status: failure.status ?? 500, opcRequestId: failure.opcRequestId ?? null },
    })
  }
}
