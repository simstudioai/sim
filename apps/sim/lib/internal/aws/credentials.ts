import { AsyncLocalStorage } from 'node:async_hooks'
import { getErrorMessage } from '@sim/utils/errors'
import { isRecordLike } from '@sim/utils/object'
import { isRetryableNetworkError } from '@/lib/core/errors/retryable-infrastructure'
import { awsRequestHandler } from '@/lib/core/network/proxy-agent.server'
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
 *    `context.authorizedServiceAccountCredential` (trusted context, never tool input).
 * 2. {@link withAwsCredential} resolves it to session credentials and
 *    substitutes them for `accessKeyId`/`secretAccessKey` before the contract parses.
 * 3. The family's client builds its SDK config with {@link awsClientConfig}, whose
 *    credentials add the session token for that resolved key pair.
 *
 * With no saved credential, step 2 calls the handler with the original request
 * object and step 3 returns the same `{ accessKeyId, secretAccessKey }` the
 * client always built, so inline-key behavior is unchanged.
 *
 * The session token is scoped to the handler's async context, so a client must
 * be built while the handler runs (every family's `create*Client` is). A client
 * cached across calls or built after the handler returns would sign without
 * the token and AWS would reject it.
 */

const sessionStorage = new AsyncLocalStorage<AwsSessionCredentials>()

/** The resolved STS session that signs for `accessKeyId`, if this call has one. */
function sessionFor(accessKeyId: string): AwsSessionCredentials | undefined {
  const session = sessionStorage.getStore()
  return session?.sessionToken && session.accessKeyId === accessKeyId ? session : undefined
}

/** SDK credentials for a client built from an operation's key fields. */
export function awsClientCredentials(
  accessKeyId: string,
  secretAccessKey: string
): { accessKeyId: string; secretAccessKey: string; sessionToken?: string } {
  const sessionToken = sessionFor(accessKeyId)?.sessionToken
  return sessionToken
    ? { accessKeyId, secretAccessKey, sessionToken }
    : { accessKeyId, secretAccessKey }
}

/**
 * How long the STS session behind `accessKeyId` lasts and when it ends, or
 * undefined for long-lived keys. Anything signed with a session, like an S3
 * presigned URL, stops working when it ends whatever expiry it asked for.
 */
export function awsSessionLifetime(
  accessKeyId: string
): Pick<AwsSessionCredentials, 'durationSeconds' | 'expiration'> | undefined {
  const session = sessionFor(accessKeyId)
  return session && { durationSeconds: session.durationSeconds, expiration: session.expiration }
}

/**
 * SDK client settings for a client built from an operation's key fields: its region,
 * {@link awsClientCredentials}, and the request handler that honors `HTTPS_PROXY`.
 */
export function awsClientConfig(region: string, accessKeyId: string, secretAccessKey: string) {
  return {
    region,
    credentials: awsClientCredentials(accessKeyId, secretAccessKey),
    requestHandler: awsRequestHandler(),
  }
}

/**
 * Runs `operation` inside a resolved session, so clients built during it sign
 * with the session token. For callers outside a tool handler, such as selectors.
 */
export function runWithAwsSession<Result>(
  session: AwsSessionCredentials,
  operation: () => Promise<Result>
): Promise<Result> {
  return sessionStorage.run(session, operation)
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

const THROTTLING_ERROR_NAMES = new Set(['Throttling', 'ThrottlingException'])

/**
 * Whether resolving a credential failed because AWS was briefly unavailable rather
 * than because it denied the credential: an error STS models as retryable
 * (IDPCommunicationError, when STS could not reach Sim's OIDC issuer), throttling,
 * an STS 5xx, or a network failure. The SDK has already retried these.
 */
function isTransientAwsFailure(error: unknown): boolean {
  if (!isRecordLike(error)) return false
  const status = isRecordLike(error.$metadata) ? error.$metadata.httpStatusCode : undefined
  return (
    error.$retryable !== undefined ||
    THROTTLING_ERROR_NAMES.has(String(error.name)) ||
    status === 429 ||
    (typeof status === 'number' && status >= 500) ||
    error.name === 'TimeoutError' ||
    isRetryableNetworkError(error)
  )
}

/** Wraps a family's operation handler so it also accepts a saved AWS credential. */
export function withAwsCredential<Result>(
  handler: InternalToolOperationHandler<Result>
): InternalToolOperationHandler<Result | Response> {
  return async (request: InternalToolOperationCall) => {
    const authorized = request.context.authorizedServiceAccountCredential
    if (authorized?.service !== 'aws') return handler(request)
    const { credentialId } = authorized

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
        { status: isTransientAwsFailure(error) ? 503 : 403 }
      )
    }
    request.signal?.throwIfAborted()

    const input = {
      ...request.input,
      accessKeyId: session.accessKeyId,
      secretAccessKey: session.secretAccessKey,
    }
    return runWithAwsSession(session, () => handler({ ...request, input }))
  }
}
