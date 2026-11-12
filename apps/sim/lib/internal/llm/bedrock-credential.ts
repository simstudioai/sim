import { getErrorMessage } from '@sim/utils/errors'
import { authorizeCredentialUseForAuth } from '@/lib/auth/credential-access'
import { AuthType } from '@/lib/auth/hybrid'
import { resolveAuthorizedAwsCredential } from '@/lib/internal/aws/credentials'
import { recordCredentialAccess } from '@/lib/oauth/token-resolution'
import { AWS_SERVICE_ACCOUNT_PROVIDER_ID } from '@/lib/oauth/types'
import type { BedrockCredentialSession } from '@/providers/types'

/** A saved AWS credential could not be used for a Bedrock request. */
export class BedrockCredentialError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options)
    this.name = 'BedrockCredentialError'
  }
}

export interface ResolveBedrockCredentialParams {
  /** The saved credential selected on the block; its ID is never trusted beyond this lookup. */
  credentialId: string
  /** The user the run acts for; must be allowed to use the credential. */
  actingUserId: string | undefined
  /** Pins the credential to this workflow's workspace. */
  workflowId?: string
  /** Pins the credential to this workspace when there is no workflow. */
  workspaceId?: string
  /** Names the STS role session after the run, so it shows in the customer's CloudTrail. */
  executionId?: string
  signal?: AbortSignal
}

/**
 * Authorizes the acting user's use of a saved AWS credential for a Bedrock model
 * call and resolves it to signing credentials: the stored key pair for access
 * keys, or a fresh STS session for an assumed or keyless role.
 *
 * Authorization is the same check every other saved-credential use passes
 * (`authorizeCredentialUseForAuth`): the user must be allowed to use the
 * credential, and it must belong to the workflow's workspace. The credential is
 * then loaded only within that workspace and only as a live AWS credential, so
 * any other credential fails here and the request never reaches Bedrock: a
 * selected credential is never replaced by inline keys or the deployment's own
 * AWS credentials.
 */
export async function resolveBedrockCredentialSession({
  credentialId,
  actingUserId,
  workflowId,
  workspaceId,
  executionId,
  signal,
}: ResolveBedrockCredentialParams): Promise<BedrockCredentialSession> {
  if (!actingUserId) {
    throw new BedrockCredentialError('Using an AWS credential requires an authenticated user')
  }

  const access = await authorizeCredentialUseForAuth(
    { success: true, userId: actingUserId, authType: AuthType.INTERNAL_JWT },
    { credentialId, workflowId, workspaceId, callerUserId: actingUserId }
  )
  if (!access.ok) {
    throw new BedrockCredentialError(access.error || 'Not authorized to use this AWS credential')
  }
  if (
    access.credentialType !== 'service_account' ||
    !access.resolvedCredentialId ||
    !access.workspaceId
  ) {
    throw new BedrockCredentialError('AWS Bedrock needs a saved AWS credential')
  }
  signal?.throwIfAborted()

  let session: Awaited<ReturnType<typeof resolveAuthorizedAwsCredential>>
  try {
    session = await resolveAuthorizedAwsCredential(
      access.resolvedCredentialId,
      { workspaceId: access.workspaceId, executionId },
      signal
    )
  } catch (error) {
    signal?.throwIfAborted()
    throw new BedrockCredentialError(
      `Could not use the AWS credential: ${getErrorMessage(error, 'Unknown error')}`,
      { cause: error }
    )
  }

  recordCredentialAccess({
    actorId: actingUserId,
    workspaceId: access.workspaceId,
    resourceId: access.resolvedCredentialId,
    providerId: AWS_SERVICE_ACCOUNT_PROVIDER_ID,
    credentialType: 'service_account',
    workflowId,
    executionId,
  })

  return {
    credentialId: access.resolvedCredentialId,
    accessKeyId: session.accessKeyId,
    secretAccessKey: session.secretAccessKey,
    ...(session.sessionToken ? { sessionToken: session.sessionToken } : {}),
    ...(session.expiration ? { expiration: session.expiration } : {}),
  }
}
