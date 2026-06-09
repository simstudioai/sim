import { MothershipStreamV1EventType } from '@/lib/copilot/generated/mothership-stream-v1'
import type { PersistedStreamEventEnvelope } from '@/lib/copilot/request/session/contract'
import { handleCompleteEvent } from '@/app/workspace/[workspaceId]/home/hooks/stream/handle-complete-event'
import { handleErrorEvent } from '@/app/workspace/[workspaceId]/home/hooks/stream/handle-error-event'
import { handleResourceEvent } from '@/app/workspace/[workspaceId]/home/hooks/stream/handle-resource-event'
import { handleRunEvent } from '@/app/workspace/[workspaceId]/home/hooks/stream/handle-run-event'
import { handleSessionEvent } from '@/app/workspace/[workspaceId]/home/hooks/stream/handle-session-event'
import { handleSpanEvent } from '@/app/workspace/[workspaceId]/home/hooks/stream/handle-span-event'
import { handleTextEvent } from '@/app/workspace/[workspaceId]/home/hooks/stream/handle-text-event'
import { handleToolEvent } from '@/app/workspace/[workspaceId]/home/hooks/stream/handle-tool-event'
import type {
  StreamEventScope,
  StreamLoopContext,
} from '@/app/workspace/[workspaceId]/home/hooks/stream/stream-context'

function computeEventScope(
  ctx: StreamLoopContext,
  parsed: PersistedStreamEventEnvelope
): StreamEventScope {
  const scopedParentToolCallId =
    typeof parsed.scope?.parentToolCallId === 'string' ? parsed.scope.parentToolCallId : undefined
  const scopedAgentId = typeof parsed.scope?.agentId === 'string' ? parsed.scope.agentId : undefined
  const scopedSpanId = typeof parsed.scope?.spanId === 'string' ? parsed.scope.spanId : undefined
  const scopedParentSpanId =
    typeof parsed.scope?.parentSpanId === 'string' ? parsed.scope.parentSpanId : undefined
  const scopedSubagent = ctx.ops.resolveScopedSubagent(
    scopedAgentId,
    scopedParentToolCallId,
    scopedSpanId
  )
  const spanIdentity: { spanId?: string; parentSpanId?: string } = {
    ...(scopedSpanId ? { spanId: scopedSpanId } : {}),
    ...(scopedParentSpanId ? { parentSpanId: scopedParentSpanId } : {}),
  }
  return {
    scopedSubagent,
    scopedParentToolCallId,
    scopedAgentId,
    scopedSpanId,
    scopedParentSpanId,
    spanIdentity,
  }
}

/**
 * Routes a parsed stream event to its handler. Per-event subagent/span scope is
 * resolved once here and passed to the handlers that nest blocks by it. The
 * caller's transport loop owns staleness, cursor dedup, and `streamId`/
 * `streamRequestId` updates; this function only mutates the supplied context.
 */
export function dispatchStreamEvent(
  ctx: StreamLoopContext,
  parsed: PersistedStreamEventEnvelope
): void {
  const scope = computeEventScope(ctx, parsed)
  switch (parsed.type) {
    case MothershipStreamV1EventType.session:
      handleSessionEvent(ctx, parsed)
      break
    case MothershipStreamV1EventType.text:
      handleTextEvent(ctx, parsed, scope)
      break
    case MothershipStreamV1EventType.tool:
      handleToolEvent(ctx, parsed, scope)
      break
    case MothershipStreamV1EventType.resource:
      handleResourceEvent(ctx, parsed)
      break
    case MothershipStreamV1EventType.run:
      handleRunEvent(ctx, parsed)
      break
    case MothershipStreamV1EventType.span:
      handleSpanEvent(ctx, parsed, scope)
      break
    case MothershipStreamV1EventType.error:
      handleErrorEvent(ctx, parsed, scope)
      break
    case MothershipStreamV1EventType.complete:
      handleCompleteEvent(ctx, parsed)
      break
  }
}
