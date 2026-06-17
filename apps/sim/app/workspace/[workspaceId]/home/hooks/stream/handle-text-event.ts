import type { PersistedStreamEventEnvelope } from '@/lib/copilot/request/session/contract'
import type { StreamLoopContext } from '@/app/workspace/[workspaceId]/home/hooks/stream/stream-context'

type TextEvent = Extract<PersistedStreamEventEnvelope, { type: 'text' }>

/**
 * Text content is folded into the model by `reduceEvent` (main and subagent
 * lanes are kept distinct, so there is no manual boundary-newline). This handler
 * only schedules a paced flush of the serialized snapshot.
 */
export function handleTextEvent(ctx: StreamLoopContext, _parsed: TextEvent): void {
  ctx.ops.flushText()
}
