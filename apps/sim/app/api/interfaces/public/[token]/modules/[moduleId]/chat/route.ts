import { createLogger } from '@sim/logger'
import { getErrorMessage } from '@sim/utils/errors'
import { generateId } from '@sim/utils/id'
import { type NextRequest, NextResponse } from 'next/server'
import {
  PUBLIC_INTERFACE_MAX_BODY_BYTES,
  publicInterfaceChatContract,
} from '@/lib/api/contracts/public-interfaces'
import { parseRequest } from '@/lib/api/server'
import { releaseExecutionSlot } from '@/lib/billing/calculations/usage-reservation'
import { admissionRejectedResponse, tryAdmit } from '@/lib/core/admission/gate'
import { generateRequestId } from '@/lib/core/utils/request'
import { serializeSelectedOutputs } from '@/lib/core/utils/response-format'
import { SSE_HEADERS } from '@/lib/core/utils/sse'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'
import { preprocessExecution } from '@/lib/execution/preprocessing'
import type { InterfaceOutputConfig } from '@/lib/interfaces/types'
import { LoggingSession } from '@/lib/logs/execution/logging-session'
import { resolvePublicInterfaceModule } from '@/lib/public-shares/interface-access'
import { enforcePerIpRateLimit, enforcePerShareRateLimit } from '@/lib/public-shares/rate-limit'
import { executeWorkflow } from '@/lib/workflows/executor/execute-workflow'
import { createExecutionEventStream } from '@/lib/workflows/streaming/execution-event-stream'
import {
  publicInterfaceNotFound,
  publicRunFailure,
} from '@/app/api/interfaces/public/[token]/modules/[moduleId]/utils'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

const logger = createLogger('PublicInterfaceChatAPI')

/**
 * POST /api/interfaces/public/[token]/modules/[moduleId]/chat
 *
 * Runs the workflow a shared interface's chat module points at and streams the
 * result back as SSE. The workflow id is **derived** from the interface's stored
 * layout and re-asserted to live in the interface's own workspace, so the token
 * can never be pointed at another workflow.
 *
 * The stream is the typed `ExecutionEvent` dialect, because the chat module
 * renders a public share through the same client as a workspace surface and
 * that client decodes only this dialect. Per-block outputs are restricted to the
 * blocks the stored module config selects — an anonymous viewer sees the answer
 * the module publishes, not every block the workflow ran.
 *
 * Publicly the run always goes through the deployed state (`checkDeployment`)
 * and always pays the per-actor plan limit (`checkRateLimit`) — the in-app chat
 * relaxes both because it has a session, and neither relaxation may reach an
 * anonymous caller. Billing attribution falls through to the workspace system
 * actor, exactly as the deployed chat does; the sharer is never billed
 * personally.
 */
/**
 * The module's output selection as `blockId -> published paths`.
 *
 * A block may be named more than once with different paths, so paths accumulate
 * per block rather than the last entry winning.
 */
function publishedOutputPaths(
  outputConfigs: readonly InterfaceOutputConfig[]
): Map<string, Set<string>> {
  const published = new Map<string, Set<string>>()
  for (const config of outputConfigs) {
    const paths = published.get(config.blockId) ?? new Set<string>()
    /**
     * An empty path means the block's `content` field — the same normalisation
     * `serializeOutputId` applies when it builds the run's `selectedOutputs`.
     * Keeping the raw `''` here made the two derivations of one config disagree,
     * and an empty path resolves to the WHOLE block output, so it forwarded
     * everything the path-level authorisation exists to withhold.
     */
    paths.add(config.path || 'content')
    published.set(config.blockId, paths)
  }
  return published
}

export const POST = withRouteHandler(
  async (
    request: NextRequest,
    context: { params: Promise<{ token: string; moduleId: string }> }
  ) => {
    const requestId = generateRequestId()

    const ticket = tryAdmit()
    if (!ticket) return admissionRejectedResponse()

    try {
      const limited = await enforcePerIpRateLimit(request, 'execute')
      if (limited) return limited

      const parsed = await parseRequest(publicInterfaceChatContract, request, context, {
        maxBodyBytes: PUBLIC_INTERFACE_MAX_BODY_BYTES,
      })
      if (!parsed.success) return parsed.response
      const { token, moduleId } = parsed.data.params
      const { input, conversationId } = parsed.data.body.input

      const result = await resolvePublicInterfaceModule({
        token,
        moduleId,
        expectedType: 'chat',
        request,
        requestId,
      })
      if (!result.ok) return result.response
      const { definition, module, share, workspaceId, resource } = result.access

      /**
       * The share is only known after the token resolves, so the aggregate
       * per-share ceiling is enforced here rather than alongside the per-IP
       * bucket above. Both apply: the per-IP bucket bounds one visitor, this one
       * bounds a link that has been passed around.
       */
      const shareLimited = await enforcePerShareRateLimit('execute', share.id)
      if (shareLimited) return shareLimited

      /** Narrowing formality — `expectedType: 'chat'` already 404s any other type. */
      if (module.type !== 'chat') return publicInterfaceNotFound()

      const workflowId = resource.id
      const executionId = generateId()
      const loggingSession = new LoggingSession(workflowId, executionId, 'chat', requestId)

      const preprocess = await preprocessExecution({
        workflowId,
        userId: definition.createdBy,
        triggerType: 'chat',
        executionId,
        requestId,
        checkRateLimit: true,
        checkDeployment: true,
        loggingSession,
      })

      if (!preprocess.success) {
        logger.warn(`[${requestId}] Public interface chat preprocessing failed`, {
          moduleId,
          status: preprocess.error.statusCode,
          error: preprocess.error.message,
        })
        return publicRunFailure(preprocess.error.statusCode)
      }

      const { actorUserId, billingAttribution, workflowRecord } = preprocess

      /**
       * Re-assert same-workspace on the resolved workflow. `validateLayout`
       * grandfathers references that were already stored, so a stored reference
       * is only proven in-workspace at the moment it was introduced.
       *
       * `preprocessExecution` reserved a billing concurrency slot; release it on
       * this early exit since no LoggingSession will finalize to free it.
       */
      if (workflowRecord.workspaceId !== workspaceId) {
        logger.warn(`[${requestId}] Public interface chat workflow left the workspace`, {
          moduleId,
        })
        await releaseExecutionSlot(executionId)
        return publicInterfaceNotFound()
      }

      /**
       * The output selection is serialized from the **stored** layout and never
       * from the request: a client-supplied `selectedOutputs` would be an
       * arbitrary output selector over every block of the workflow.
       */
      const selectedOutputs = serializeSelectedOutputs(module.config.outputConfigs)

      try {
        const stream = createExecutionEventStream({
          requestId,
          executionId,
          workflowId,
          workspaceId,
          userId: actorUserId,
          publishedOutputs: publishedOutputPaths(module.config.outputConfigs),
          executeFn: async ({ onStream, onBlockStart, onBlockComplete, abortSignal }) =>
            executeWorkflow(
              {
                id: workflowId,
                userId: workflowRecord.userId,
                workspaceId,
                isDeployed: workflowRecord.isDeployed,
                variables: (workflowRecord.variables as Record<string, unknown>) ?? undefined,
              },
              requestId,
              { input, conversationId },
              actorUserId,
              {
                enabled: true,
                selectedOutputs,
                isSecureMode: true,
                workflowTriggerType: 'chat',
                onStream,
                onBlockStart,
                onBlockComplete,
                skipLoggingComplete: true,
                abortSignal,
                executionMode: 'stream',
                billingAttribution,
              },
              executionId
            ),
        })

        return new NextResponse(stream, { status: 200, headers: SSE_HEADERS })
      } catch (error) {
        logger.error(`[${requestId}] Public interface chat stream setup failed`, {
          moduleId,
          error: getErrorMessage(error),
        })
        // Setup failed before the workflow stream took over slot release; free
        // the reserved billing slot (idempotent if already released).
        await releaseExecutionSlot(executionId)
        return publicRunFailure(500)
      }
    } finally {
      ticket.release()
    }
  }
)
