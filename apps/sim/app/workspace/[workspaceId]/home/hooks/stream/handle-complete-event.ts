import type { PersistedStreamEventEnvelope } from '@/lib/copilot/request/session/contract'
import type { StreamLoopContext } from '@/app/workspace/[workspaceId]/home/hooks/stream/stream-context'

type CompleteEvent = Extract<PersistedStreamEventEnvelope, { type: 'complete' }>

/**
 * Turn termination and the deterministic propagation of the outcome to any
 * still-open node are folded into the model by `reduceEvent` (which skips an
 * async pause). This handler only records the terminal flag and flushes.
 */
export function handleCompleteEvent(ctx: StreamLoopContext, _parsed: CompleteEvent): void {
  ctx.state.sawCompleteEvent = true
  ctx.ops.flush()
}
