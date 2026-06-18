import type { PersistedStreamEventEnvelope } from '@/lib/copilot/request/session/contract'
import type { StreamLoopContext } from '@/app/workspace/[workspaceId]/home/hooks/stream/stream-context'

type RunEvent = Extract<PersistedStreamEventEnvelope, { type: 'run' }>

/**
 * Compaction lifecycle is folded into the model by `reduceEvent` (it opens and
 * closes a `context_compaction` node with titles). This handler only flushes the
 * serialized snapshot.
 */
export function handleRunEvent(ctx: StreamLoopContext, _parsed: RunEvent): void {
  ctx.ops.flush()
}
