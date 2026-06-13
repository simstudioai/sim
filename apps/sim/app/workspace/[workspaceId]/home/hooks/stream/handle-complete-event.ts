import { MothershipStreamV1CompletionStatus } from '@/lib/copilot/generated/mothership-stream-v1'
import type { PersistedStreamEventEnvelope } from '@/lib/copilot/request/session/contract'
import type { StreamLoopContext } from '@/app/workspace/[workspaceId]/home/hooks/stream/stream-context'
import {
  asPayloadRecord,
  finalizeResidualToolCalls,
} from '@/app/workspace/[workspaceId]/home/hooks/stream/stream-helpers'

type CompleteEvent = Extract<PersistedStreamEventEnvelope, { type: 'complete' }>

export function handleCompleteEvent(ctx: StreamLoopContext, parsed: CompleteEvent): void {
  const { state, ops } = ctx
  state.sawCompleteEvent = true
  ops.stampBlockEnd(state.blocks[state.blocks.length - 1])
  const completeResponse = asPayloadRecord(parsed.payload.response)
  if (completeResponse === undefined || !('async_pause' in completeResponse)) {
    finalizeResidualToolCalls(
      state.blocks,
      parsed.payload.status === MothershipStreamV1CompletionStatus.cancelled
        ? 'cancelled'
        : 'complete'
    )
    ops.flush()
  }
}
