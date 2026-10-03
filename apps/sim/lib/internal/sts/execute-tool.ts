import { toError } from '@sim/utils/errors'
import type { z } from 'zod'
import {
  executeStsAssumeRole,
  executeStsAssumeRoleWithSAML,
  executeStsAssumeRoleWithWebIdentity,
  executeStsGetAccessKeyInfo,
  executeStsGetCallerIdentity,
  executeStsGetSessionToken,
} from '@/lib/internal/sts/operations'
import {
  stsAssumeRoleInputSchema,
  stsAssumeRoleWithSamlInputSchema,
  stsAssumeRoleWithWebIdentityInputSchema,
  stsGetAccessKeyInfoInputSchema,
  stsGetCallerIdentityInputSchema,
  stsGetSessionTokenInputSchema,
} from '@/lib/internal/sts/schema'
import type { InternalToolOperationHandler } from '@/lib/internal/tool-operations/types'

async function executeOperation<TInput>(
  schema: z.ZodType<TInput>,
  input: unknown,
  execute: (input: TInput, signal?: AbortSignal) => Promise<unknown>,
  errorMessage: string,
  signal?: AbortSignal
): Promise<Response> {
  signal?.throwIfAborted()
  const parsed = schema.safeParse(input)
  if (!parsed.success) {
    return Response.json(
      { error: 'Invalid request data', details: parsed.error.issues },
      { status: 400 }
    )
  }

  try {
    const result = await execute(parsed.data, signal)
    signal?.throwIfAborted()
    return Response.json(result)
  } catch (error) {
    signal?.throwIfAborted()
    return Response.json({ error: `${errorMessage}: ${toError(error).message}` }, { status: 500 })
  }
}

export const executeStsTool: InternalToolOperationHandler = async ({ toolId, input, signal }) => {
  signal?.throwIfAborted()

  switch (toolId) {
    case 'sts_assume_role':
      return executeOperation(
        stsAssumeRoleInputSchema,
        input,
        executeStsAssumeRole,
        'Failed to assume role',
        signal
      )
    case 'sts_assume_role_with_web_identity':
      return executeOperation(
        stsAssumeRoleWithWebIdentityInputSchema,
        input,
        executeStsAssumeRoleWithWebIdentity,
        'Failed to assume role with web identity',
        signal
      )
    case 'sts_assume_role_with_saml':
      return executeOperation(
        stsAssumeRoleWithSamlInputSchema,
        input,
        executeStsAssumeRoleWithSAML,
        'Failed to assume role with SAML',
        signal
      )
    case 'sts_get_caller_identity':
      return executeOperation(
        stsGetCallerIdentityInputSchema,
        input,
        executeStsGetCallerIdentity,
        'Failed to get caller identity',
        signal
      )
    case 'sts_get_session_token':
      return executeOperation(
        stsGetSessionTokenInputSchema,
        input,
        executeStsGetSessionToken,
        'Failed to get session token',
        signal
      )
    case 'sts_get_access_key_info':
      return executeOperation(
        stsGetAccessKeyInfoInputSchema,
        input,
        executeStsGetAccessKeyInfo,
        'Failed to get access key info',
        signal
      )
    default:
      return Response.json({ error: `Unsupported STS tool: ${toolId}` }, { status: 500 })
  }
}
