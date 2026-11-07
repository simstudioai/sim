import { AsyncLocalStorage } from 'node:async_hooks'
import { getErrorMessage } from '@sim/utils/errors'
import { isRecordLike } from '@sim/utils/object'
import {
  type AwsSessionCredentials,
  buildAwsRoleSessionName,
  getAwsCredentialConfig,
  resolveAwsSessionCredentials,
} from '@/lib/credentials/aws-service-account.server'
import type {
  InternalToolOperationCall,
  InternalToolOperationHandler,
} from '@/lib/internal/tool-operations/types'

/**
 * Saved-credential support for every AWS tool family.
 *
 * An AWS operation was written for inline keys: its contract requires an
 * access key pair and its client signs with exactly that pair. A saved
 * credential plugs in underneath without touching either:
 *
 * 1. The executor authorizes the credential and sets
 *    `context.authorizedAwsCredentialId` (trusted context, never tool input).
 * 2. {@link withAwsCredential} resolves it to session credentials and
 *    substitutes them for `accessKeyId`/`secretAccessKey` before the contract parses.
 * 3. The family's client asks {@link awsClientCredentials} for its SDK
 *    credentials, which adds the session token for that resolved key pair.
 *
 * With no saved credential, step 2 calls the handler with the original request
 * object and step 3 returns the same `{ accessKeyId, secretAccessKey }` the
 * client always built, so inline-key behavior is unchanged.
 */

const sessionStorage = new AsyncLocalStorage<AwsSessionCredentials>()

/** SDK credentials for a client built from an operation's key fields. */
export function awsClientCredentials(
  accessKeyId: string,
  secretAccessKey: string
): { accessKeyId: string; secretAccessKey: string; sessionToken?: string } {
  const session = sessionStorage.getStore()
  if (session?.sessionToken && session.accessKeyId === accessKeyId) {
    return { accessKeyId, secretAccessKey, sessionToken: session.sessionToken }
  }
  return { accessKeyId, secretAccessKey }
}

/**
 * Resolves an executor-authorized AWS credential for the run's owner scope.
 * Also used directly by AWS tools that sign their own HTTP requests.
 */
export async function resolveAuthorizedAwsCredential(
  credentialId: string,
  context: { workspaceId?: string; organizationId?: string; executionId?: string },
  signal?: AbortSignal
): Promise<AwsSessionCredentials> {
  const { config, owner } = await getAwsCredentialConfig(credentialId, {
    workspaceId: context.workspaceId,
    organizationId: context.organizationId,
  })
  signal?.throwIfAborted()
  return resolveAwsSessionCredentials(config, owner, {
    roleSessionName: buildAwsRoleSessionName(context.executionId),
    signal,
  })
}

/** Wraps a family's operation handler so it also accepts a saved AWS credential. */
export function withAwsCredential<Result>(
  handler: InternalToolOperationHandler<Result>
): InternalToolOperationHandler<Result | Response> {
  return async (request: InternalToolOperationCall) => {
    const credentialId = request.context.authorizedAwsCredentialId
    if (!credentialId) return handler(request)

    if (!isRecordLike(request.input)) {
      return Response.json({ error: 'Invalid request data' }, { status: 400 })
    }

    let session: AwsSessionCredentials
    try {
      session = await resolveAuthorizedAwsCredential(credentialId, request.context, request.signal)
    } catch (error) {
      request.signal?.throwIfAborted()
      return Response.json(
        { error: `Could not use the AWS credential: ${getErrorMessage(error, 'Unknown error')}` },
        { status: 403 }
      )
    }
    request.signal?.throwIfAborted()

    const input = {
      ...request.input,
      accessKeyId: session.accessKeyId,
      secretAccessKey: session.secretAccessKey,
    }
    return sessionStorage.run(session, () => handler({ ...request, input }))
  }
}
