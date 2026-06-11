import { MothershipStreamV1RunKind } from '@/lib/copilot/generated/mothership-stream-v1'
import type { PersistedStreamEventEnvelope } from '@/lib/copilot/request/session/contract'
import type { StreamLoopContext } from '@/app/workspace/[workspaceId]/home/hooks/stream/stream-context'

type RunEvent = Extract<PersistedStreamEventEnvelope, { type: 'run' }>

export function handleRunEvent(ctx: StreamLoopContext, parsed: RunEvent): void {
  const { state, ops } = ctx
  const payload = parsed.payload

  if (payload.kind === MothershipStreamV1RunKind.compaction_start) {
    const compactionId = `compaction_${Date.now()}`
    state.activeCompactionId = compactionId
    ops.stampBlockEnd(state.blocks[state.blocks.length - 1])
    state.toolMap.set(compactionId, state.blocks.length)
    state.blocks.push({
      type: 'tool_call',
      toolCall: {
        id: compactionId,
        name: 'context_compaction',
        status: 'executing',
        displayTitle: 'Compacting context...',
      },
      timestamp: Date.now(),
    })
    ops.flush()
    return
  }

  if (payload.kind === MothershipStreamV1RunKind.compaction_done) {
    const compactionId = state.activeCompactionId || `compaction_${Date.now()}`
    state.activeCompactionId = undefined
    const idx = state.toolMap.get(compactionId)
    if (idx !== undefined && state.blocks[idx]?.toolCall) {
      state.blocks[idx].toolCall!.status = 'success'
      state.blocks[idx].toolCall!.displayTitle = 'Compacted context'
      ops.stampBlockEnd(state.blocks[idx])
    } else {
      state.toolMap.set(compactionId, state.blocks.length)
      const endNow = Date.now()
      state.blocks.push({
        type: 'tool_call',
        toolCall: {
          id: compactionId,
          name: 'context_compaction',
          status: 'success',
          displayTitle: 'Compacted context',
        },
        timestamp: endNow,
        endedAt: endNow,
      })
    }
    ops.flush()
  }
}
