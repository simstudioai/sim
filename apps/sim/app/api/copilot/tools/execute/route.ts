import { createLogger } from '@sim/logger'
import { getErrorMessage } from '@sim/utils/errors'
import { type NextRequest, NextResponse } from 'next/server'
import { copilotToolExecuteInternalBodySchema } from '@/lib/api/contracts/copilot'
import { validationErrorResponse } from '@/lib/api/server'
import { prepareCopilotEnvironmentContext } from '@/lib/copilot/environment-context'
import { MothershipStreamV1ToolOutcome } from '@/lib/copilot/generated/mothership-stream-v1'
import { TraceAttr } from '@/lib/copilot/generated/trace-attributes-v1'
import { TraceSpan } from '@/lib/copilot/generated/trace-spans-v1'
import { checkInternalApiKey } from '@/lib/copilot/request/http'
import { withIncomingGoSpan } from '@/lib/copilot/request/otel'
import {
  describeWithholdingCause,
  inspectToolResultForCopilot,
  projectToolErrorMessageForCopilot,
} from '@/lib/copilot/request/tools/resolved-secret-result'
import { handleResourceSideEffects } from '@/lib/copilot/request/tools/resources'
import type { ToolCallResult } from '@/lib/copilot/request/types'
import { ensureHandlersRegistered } from '@/lib/copilot/tool-executor'
import { executeTool } from '@/lib/copilot/tool-executor/executor'
import { TOOL_EFFECT_PHASE } from '@/lib/copilot/tool-executor/types'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'
import type { ResolvedSecretTraceRegistry } from '@/executor/utils/resolved-secret-trace-registry'

const logger = createLogger('CopilotToolExecuteInternalAPI')

/**
 * In-band calls are stateless one-offs, but the turn they serve is not: secret
 * provenance activated by one tool call must stay visible to the next call's
 * egress projection, exactly as the request-lifecycle registry accumulates
 * across a turn. Keyed by the turn (messageId) so one background lane shares
 * one registry; TTL-evicted since nothing signals turn end on this route.
 */
const TURN_REGISTRY_TTL_MS = 10 * 60 * 1000
const TURN_REGISTRY_CACHE_MAX = 256
const turnRegistryCache = new Map<
  string,
  { registry: ResolvedSecretTraceRegistry; expiresAt: number }
>()

async function getTurnEgressRegistry(
  userId: string,
  workspaceId: string | undefined,
  messageId: string | undefined,
  requestMode?: string,
  organizationId?: string
): Promise<ResolvedSecretTraceRegistry> {
  const key = `${userId}\u0000${workspaceId ?? ''}\u0000${organizationId ?? ''}\u0000${messageId ?? ''}\u0000${requestMode ?? ''}`
  const now = Date.now()
  const hit = turnRegistryCache.get(key)
  if (hit && hit.expiresAt > now) {
    hit.expiresAt = now + TURN_REGISTRY_TTL_MS
    return hit.registry
  }
  const environmentContext = await prepareCopilotEnvironmentContext(userId, workspaceId, {
    includeSecrets: requestMode !== 'assistant',
  })
  for (const [cachedKey, cached] of turnRegistryCache) {
    if (cached.expiresAt <= now) turnRegistryCache.delete(cachedKey)
  }
  if (turnRegistryCache.size >= TURN_REGISTRY_CACHE_MAX) {
    const oldest = turnRegistryCache.keys().next().value
    if (oldest !== undefined) turnRegistryCache.delete(oldest)
  }
  turnRegistryCache.set(key, {
    registry: environmentContext.resolvedSecretTraceRegistry,
    expiresAt: now + TURN_REGISTRY_TTL_MS,
  })
  return environmentContext.resolvedSecretTraceRegistry
}

// POST /api/copilot/tools/execute — internal (Go → Sim) in-band execution of
// one sim-server tool announced on a LIVE mothership turn. This is what lets
// background (async) subagents — and the main lane while background agents are
// running — use sim-executed tools without a checkpoint pause: Go calls here
// synchronously instead of parking the turn, and the tool runs through the
// same server tool router the resume driver uses. Trusted server-to-server
// only: Go supplies the acting user, proven by the internal API secret.
//
// Results cross a model boundary here just as they do in the resume driver, so
// this route mirrors its provenance discipline: a per-call registry fork feeds
// the handler, the settled result is projected before it returns to Go, and
// the fork is merged back only when the projection was safe and the fork
// stayed complete. Without this, every result crossed unprojected and every
// thrown error was replaced by the opaque "could not be returned safely"
// sentinel (the projection fails closed on a missing registry).
export const POST = withRouteHandler((request: NextRequest) =>
  withIncomingGoSpan(
    request.headers,
    TraceSpan.CopilotToolsExecuteInband,
    undefined,
    async (rootSpan) => {
      const authResult = checkInternalApiKey(request)
      if (!authResult.success) {
        return NextResponse.json(
          { success: false, error: authResult.error || 'Authentication failed' },
          { status: 401 }
        )
      }

      // boundary-raw-json: tolerant parse; validation happens via the contract schema below
      const body = await request.json().catch(() => ({}))
      const validation = copilotToolExecuteInternalBodySchema.safeParse(body)
      if (!validation.success) {
        return validationErrorResponse(validation.error, 'Invalid request body')
      }
      const {
        toolCallId,
        toolName,
        params,
        userId,
        workflowId,
        workspaceId,
        organizationId,
        chatId,
        messageId,
        parentToolCallId,
        userPermission,
        requestMode,
        assistantSearch,
      } = validation.data
      rootSpan.setAttributes({
        [TraceAttr.ToolName]: toolName,
        [TraceAttr.ToolCallId]: toolCallId,
        [TraceAttr.UserId]: userId,
      })

      let toolRegistry: ResolvedSecretTraceRegistry
      let turnRegistry: ResolvedSecretTraceRegistry
      try {
        turnRegistry = await getTurnEgressRegistry(
          userId,
          workspaceId,
          messageId,
          requestMode,
          organizationId
        )
        toolRegistry = turnRegistry.forkForInputPaths([])
      } catch (err) {
        /**
         * Without a catalog the projection can vouch for nothing, so every result this call
         * could produce would be withheld. Running the tool anyway was the worst of both
         * outcomes: the side effect happened and the caller got an opaque sentinel that named
         * neither the cause nor whether anything had changed. Refusing before dispatch is
         * both truthful and the only answer that leaves nothing behind.
         *
         * The cause is almost always the workspace itself — a deleted or inaccessible id
         * reaching this lane — which is actionable, so it is reported rather than swallowed.
         */
        logger.error('In-band egress registry unavailable; refusing the call', {
          toolName,
          toolCallId,
          userId,
          workspaceId,
          error: getErrorMessage(err),
        })
        rootSpan.setAttributes({ [TraceAttr.ToolOutcome]: MothershipStreamV1ToolOutcome.error })
        /**
         * The thrown reason stays in the log. It is an environment or database failure that
         * nothing here can project — the catalog it needed is the very thing that is missing —
         * so this is the one message on this route that must be fixed text. The workspace id
         * is echoed because the caller supplied it, and it is what makes this actionable.
         */
        return NextResponse.json({
          success: false,
          error: workspaceId
            ? `${toolName} was not run: its workspace (${workspaceId}) could not be resolved. Check that the workspace exists and is accessible before retrying.`
            : `${toolName} was not run: its execution environment could not be resolved.`,
          output: { resultWithheld: true, effect: TOOL_EFFECT_PHASE.notAttempted },
        })
      }

      try {
        // The relay's comprehensive dispatcher: registry handlers (VFS
        // glob/read/grep, function execute, ...) plus the server tool router
        // fallback — the plain server-tool adapter alone rejects VFS tools
        // with "Unknown server tool".
        await ensureHandlersRegistered()
        const result = await executeTool(toolName, params, {
          userId,
          workflowId: workflowId ?? '',
          workspaceId,
          organizationId,
          chatId,
          messageId,
          toolCallId,
          parentToolCallId,
          userPermission,
          copilotToolExecution: true,
          copilotInteractionMode: 'interactive',
          requestMode,
          assistantSearch,
          resolvedSecretTraceRegistry: toolRegistry,
        })
        const projection = inspectToolResultForCopilot(result, toolRegistry, toolName)
        const projected = projection.result
        if (projection.safe && toolRegistry.isComplete()) {
          turnRegistry.mergeToolCallRegistry(toolRegistry)
        }
        if (!projection.safe) {
          /**
           * Reported on its own rather than folded into the failure branch below: a withheld
           * SUCCESS keeps `projected.success` true, so gating on failure meant the one case
           * that leaves no other trace — the model reads a bare success — was also the one
           * case whose cause was never written down.
           */
          logger.warn('In-band tool result withheld by egress projection', {
            toolName,
            toolCallId,
            runtimeSucceeded: result.success,
            ...describeWithholdingCause(projection.cause),
          })
        }
        if (!projected.success) {
          logger.warn('In-band tool execution failed', {
            toolName,
            toolCallId,
            error: projected.error,
            runtimeSucceeded: result.success,
            projectionSafe: projection.safe,
          })
        }
        if (result.success && chatId) {
          // Persist created/deleted resources on the chat (file chips, table
          // links) exactly like the resume driver does. No live event sink
          // exists for an out-of-band route, so chips surface from the
          // persisted chat resources rather than a mid-turn push. Side effects
          // read the raw result; only model-facing content is projected.
          const asToolResult = { success: result.success, output: result.output } as ToolCallResult
          await handleResourceSideEffects(
            toolName,
            params,
            asToolResult,
            { success: projected.success, output: projected.output } as ToolCallResult,
            chatId,
            undefined,
            () => false
          ).catch((err) => {
            logger.warn('In-band resource side effects failed', {
              toolName,
              toolCallId,
              error: getErrorMessage(err),
            })
          })
        }
        return NextResponse.json({
          success: projected.success,
          ...(projected.output !== undefined ? { output: projected.output } : {}),
          ...(projected.error ? { error: projected.error } : {}),
        })
      } catch (err) {
        const message = projectToolErrorMessageForCopilot(
          getErrorMessage(err),
          toolRegistry,
          toolName
        )
        logger.error('In-band tool execution threw', {
          toolName,
          toolCallId,
          error: getErrorMessage(err),
        })
        return NextResponse.json({ success: false, error: message }, { status: 500 })
      }
    }
  )
)
