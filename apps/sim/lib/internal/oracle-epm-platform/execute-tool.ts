import { ORACLE_EPM_SERVICE_ACCOUNT_PROVIDER_ID } from '@/lib/credentials/client-credential-accounts/descriptors'
import { createOracleEpmClient } from '@/lib/internal/oracle-epm/client.server'
import { OracleEpmError } from '@/lib/internal/oracle-epm/errors'
import { OracleEpmPlatformFileError } from '@/lib/internal/oracle-epm-platform/files.server'
import { oracleEpmPlatformToolHandlers } from '@/lib/internal/oracle-epm-platform/operations'
import {
  OracleEpmPlatformResponseError,
  OracleEpmPlatformStatusError,
} from '@/lib/internal/oracle-epm-platform/responses'
import {
  inputSchemas,
  type OracleEpmPlatformInput,
} from '@/lib/internal/oracle-epm-platform/schemas'
import type {
  InternalToolOperationCall,
  InternalToolOperationHandler,
} from '@/lib/internal/tool-operations/types'
import { resolveOAuthAccountId } from '@/lib/oauth/credential-service'
import type { OracleEpmPlatformOperation } from '@/tools/oracle_epm_platform/types'

async function executeOperation<K extends OracleEpmPlatformOperation>(
  operation: K,
  request: InternalToolOperationCall
): Promise<Response> {
  const parsed = inputSchemas[operation].safeParse(request.input)
  if (!parsed.success) {
    // Do not return Zod issues/received values from password-bearing batch inputs.
    return Response.json(
      {
        success: false,
        error: 'Invalid Oracle EPM Platform input',
        retryable: false,
      },
      { status: 400 }
    )
  }
  const input = parsed.data as OracleEpmPlatformInput<K>
  // The executor has already authorized and resolved this selected credential. Pin its provider
  // before creating the destination or reading any file, as in the NetSuite selector attachment.
  const credential = await resolveOAuthAccountId(input.oauthCredential)
  if (
    credential?.credentialType !== 'service_account' ||
    credential.providerId !== ORACLE_EPM_SERVICE_ACCOUNT_PROVIDER_ID
  ) {
    return Response.json(
      {
        success: false,
        error: 'Select an Oracle EPM service-account credential',
        retryable: false,
      },
      { status: 403 }
    )
  }
  request.signal?.throwIfAborted()
  const client = createOracleEpmClient({
    accessToken: input.accessToken,
    instanceUrl: input.instanceUrl,
  })
  const output = await oracleEpmPlatformToolHandlers[operation](input, {
    client,
    signal: request.signal,
    execution: request.context,
  })
  request.signal?.throwIfAborted()
  const success = output.status <= 0 && !('partialFailure' in output && output.partialFailure)
  return Response.json({
    success,
    output,
    retryable: false,
    ...(!success ? { error: output.message } : {}),
  })
}

export const executeOracleEpmPlatformTool: InternalToolOperationHandler = async (request) => {
  request.signal?.throwIfAborted()
  const prefix = 'oracle_epm_platform_'
  const operation = request.toolId.startsWith(prefix) ? request.toolId.slice(prefix.length) : ''
  if (!Object.hasOwn(inputSchemas, operation)) {
    return Response.json(
      {
        success: false,
        error: 'Unsupported Oracle EPM Platform operation',
        retryable: false,
      },
      { status: 400 }
    )
  }
  try {
    return await executeOperation(operation as OracleEpmPlatformOperation, request)
  } catch (error) {
    request.signal?.throwIfAborted()
    const safe =
      error instanceof OracleEpmError ||
      error instanceof OracleEpmPlatformResponseError ||
      error instanceof OracleEpmPlatformStatusError ||
      error instanceof OracleEpmPlatformFileError
    const message = safe
      ? error.message
      : error instanceof DOMException && error.name === 'TimeoutError'
        ? 'Oracle EPM waiting deadline exceeded; check the job before retrying'
        : 'Oracle EPM Platform operation failed; state-changing requests are not automatically retried'
    return Response.json({ success: false, error: message, retryable: false }, { status: 500 })
  }
}
