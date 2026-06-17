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
import { reduceEvent } from '@/app/workspace/[workspaceId]/home/hooks/stream/turn-model'

// The model owns subagent attribution by scope identity; only the span handler
// needs scope, and only these three fields (agent id for file-preview seeding,
// span/parent ids for lane identity).
function computeEventScope(parsed: PersistedStreamEventEnvelope): StreamEventScope {
  return {
    scopedParentToolCallId:
      typeof parsed.scope?.parentToolCallId === 'string'
        ? parsed.scope.parentToolCallId
        : undefined,
    scopedAgentId: typeof parsed.scope?.agentId === 'string' ? parsed.scope.agentId : undefined,
    scopedSpanId: typeof parsed.scope?.spanId === 'string' ? parsed.scope.spanId : undefined,
  }
}

/**
 * Folds a parsed stream event into the model (the single source of truth), then
 * routes it to its side-effect handler. Span scope is computed only for the span
 * handler (handlers no longer nest blocks — the model does). The caller's
 * transport loop owns staleness, cursor dedup, and `streamId`/`streamRequestId`.
 */
export function dispatchStreamEvent(
  ctx: StreamLoopContext,
  parsed: PersistedStreamEventEnvelope
): void {
  // The model is the single source of truth: fold every event into it first,
  // then run the handlers for their side effects (resource/query/preview) and
  // the snapshot flush, which serializes the model.
  reduceEvent(ctx.state.model, parsed)
  switch (parsed.type) {
    case MothershipStreamV1EventType.session:
      handleSessionEvent(ctx, parsed)
      break
    case MothershipStreamV1EventType.text:
      handleTextEvent(ctx, parsed)
      break
    case MothershipStreamV1EventType.tool:
      handleToolEvent(ctx, parsed)
      break
    case MothershipStreamV1EventType.resource:
      handleResourceEvent(ctx, parsed)
      break
    case MothershipStreamV1EventType.run:
      handleRunEvent(ctx, parsed)
      break
    case MothershipStreamV1EventType.span:
      handleSpanEvent(ctx, parsed, computeEventScope(parsed))
      break
    case MothershipStreamV1EventType.error:
      handleErrorEvent(ctx, parsed)
      break
    case MothershipStreamV1EventType.complete:
      handleCompleteEvent(ctx, parsed)
      break
  }
}
