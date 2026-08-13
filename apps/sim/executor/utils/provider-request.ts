import { createLogger } from '@sim/logger'
import { checkWorkspaceAccess } from '@/lib/workspaces/permissions/utils'
import type { ExecutionContext } from '@/executor/types'
import type { ResolvedSecretTraceRegistry } from '@/executor/utils/resolved-secret-trace-registry'
import { executeProviderRequest } from '@/providers'
import type { ProviderRequest, ProviderResponse } from '@/providers/types'

const logger = createLogger('ExecutorProviderRequest')

export interface ExecuteBlockProviderRequestInput {
  ctx: ExecutionContext
  providerId: string
  request: ProviderRequest
  /**
   * The fork the block's model input was projected through. Supplied to the
   * provider runtime in place of the provenance envelope the HTTP boundary used
   * to serialize and re-import.
   */
  resolvedSecretTraceRegistry: ResolvedSecretTraceRegistry | undefined
}

/**
 * Runs one non-streaming provider request for a block handler in-process.
 *
 * Replaces the executor's `POST /api/providers` round trip, which re-derived
 * everything it needed from claims the executor had itself just supplied. The
 * two admission checks the route owned are reproduced here so the outcome is
 * unchanged:
 *
 * - `checkInternalAuth` rejected a token carrying no user. The executor mints
 *   that token from `ctx.userId`, so the check reduces to requiring one.
 * - `checkWorkspaceAccess` rejected an execution subject who is no longer a
 *   member of the workspace being billed.
 *
 * The route's remaining work is either already done by the caller (the model
 * permission policy, via `validateModelProvider`; Vertex credential
 * authorization, via `resolveVertexCredential`) or lives inside
 * `executeProviderRequest` itself (BYOK key resolution, attachment provenance
 * filtering, cost policy).
 */
export async function executeBlockProviderRequest({
  ctx,
  providerId,
  request,
  resolvedSecretTraceRegistry,
}: ExecuteBlockProviderRequestInput): Promise<ProviderResponse> {
  if (!ctx.userId) {
    throw new Error('Unauthorized')
  }

  if (request.workspaceId) {
    const workspaceAccess = await checkWorkspaceAccess(request.workspaceId, ctx.userId)
    if (!workspaceAccess.hasAccess) {
      throw new Error('Forbidden')
    }
  }

  /**
   * `executionContext` is deliberately not supplied: it is only inherited by
   * model-emitted tool calls, and the route this replaces never carried one.
   * Router and evaluator requests declare no tools, so passing the executor's
   * context here would widen the trusted surface without changing any outcome.
   */
  const response = await executeProviderRequest(
    providerId,
    { ...request, userId: ctx.userId },
    { resolvedSecretTraceRegistry }
  )

  if (response instanceof ReadableStream || (response !== null && 'stream' in response)) {
    logger.error('Provider returned a stream for a non-streaming block request', { providerId })
    throw new Error('Provider returned a streaming response for a non-streaming request')
  }

  return response
}
