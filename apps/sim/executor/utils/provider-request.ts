import { createLogger } from '@sim/logger'
import { checkWorkspaceAccess } from '@/lib/workspaces/permissions/utils'
import type { ExecutionContext } from '@/executor/types'
import type { ResolvedSecretTraceRegistry } from '@/executor/utils/resolved-secret-trace-registry'
import { executeProviderRequest } from '@/providers'
import type { ProviderRequest, ProviderResponse } from '@/providers/types'

const logger = createLogger('ExecutorProviderRequest')

interface ExecuteBlockProviderRequestInput {
  ctx: ExecutionContext
  providerId: string
  request: ProviderRequest
  /** Supplied in place of the provenance envelope the HTTP boundary serialized and re-imported. */
  resolvedSecretTraceRegistry: ResolvedSecretTraceRegistry | undefined
}

/**
 * Runs one non-streaming provider request for a block handler in-process, replacing the
 * executor's `POST /api/providers` round trip. The route's two admission checks are
 * reproduced so the outcome is unchanged: an internal token with no user is rejected (the
 * executor mints it from `ctx.userId`), and an execution subject who has left the billed
 * workspace is rejected. The route's remaining work is already done by the caller or lives
 * inside `executeProviderRequest`.
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
   * No `executionContext`: it is only inherited by model-emitted tool calls, and the route
   * this replaces never carried one. The whole context is omitted when there is no registry
   * rather than passed carrying `undefined` — `executeProviderTool` reads that as missing
   * provenance and fails the call closed with no error text.
   */
  const response = await executeProviderRequest(
    providerId,
    { ...request, userId: ctx.userId },
    resolvedSecretTraceRegistry ? { resolvedSecretTraceRegistry } : undefined
  )

  if (
    response instanceof ReadableStream ||
    (typeof response === 'object' && response !== null && 'stream' in response)
  ) {
    logger.error('Provider returned a stream for a non-streaming block request', { providerId })
    throw new Error('Provider returned a streaming response for a non-streaming request')
  }

  logger.info('Provider request completed', {
    providerId,
    model: request.model,
    workflowId: ctx.workflowId,
  })

  return response
}
