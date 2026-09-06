import { reconcileTextEvent } from '@/lib/mothership/request/go/text-receipt'
import { applyStreamEvent } from '@/lib/mothership/request/handlers'
import type {
  ExecutionContext,
  StreamEvent,
  StreamingContext,
} from '@/lib/mothership/request/types'

/** Saved delivery is evidence; only a fresh worker handoff can request tool execution. */
export async function restoreStreamingContext(
  events: readonly StreamEvent[],
  context: StreamingContext,
  execContext: ExecutionContext
): Promise<void> {
  for (const saved of events) {
    const event = reconcileTextEvent(saved, context.accumulatedContent)
    if (!event) continue
    const replay: StreamEvent =
      event.type === 'tool' && 'phase' in event.payload && event.payload.phase === 'call'
        ? {
            type: 'tool',
            scope: event.scope,
            seq: event.seq,
            payload: { ...event.payload, replay: true },
          }
        : event
    await applyStreamEvent(replay, context, execContext, { autoExecuteTools: false })
  }
  context.awaitingAsyncContinuation = undefined
  context.streamComplete = false
}
