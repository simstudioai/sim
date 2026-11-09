import type { PersistedStreamEventEnvelope } from '@/lib/mothership/request/session/contract'
import type { StreamLoopContext } from '@/hooks/mothership-chat/stream/context'

type RunEvent = Extract<PersistedStreamEventEnvelope, { type: 'run' }>

/**
 * Compaction lifecycle is folded into the model by `reduceEvent` (it opens and
 * closes a `context_compaction` node with titles). This handler only flushes the
 * serialized snapshot.
 */
export function handleRunEvent(ctx: StreamLoopContext, _parsed: RunEvent): void {
  ctx.ops.flush()
}
