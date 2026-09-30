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
    // Preview content already in the replay counts toward this turn's preview budget.
    if (
      saved.type === 'tool' &&
      'previewPhase' in saved.payload &&
      saved.payload.previewPhase === 'file_preview_content'
    ) {
      context.filePreviewBudget.contentBytes += Buffer.byteLength(saved.payload.content, 'utf8')
    }
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
