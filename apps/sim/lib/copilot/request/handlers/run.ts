import {
  MothershipStreamV1RunKind,
  MothershipStreamV1ToolOutcome,
} from '@/lib/copilot/generated/mothership-stream-v1'
import { getEventData } from '@/lib/copilot/request/sse-utils'
import type { StreamHandler } from './types'
import { addContentBlock } from './types'

export const handleRunEvent: StreamHandler = (event, context) => {
  const d = getEventData(event)
  if (!d) return

  const kind = d?.kind as string | undefined

  if (kind === MothershipStreamV1RunKind.checkpoint_pause) {
    context.awaitingAsyncContinuation = {
      checkpointId: String(d?.checkpointId),
      executionId: typeof d?.executionId === 'string' ? d.executionId : context.executionId,
      runId: typeof d?.runId === 'string' ? d.runId : context.runId,
      pendingToolCallIds: Array.isArray(d?.pendingToolCallIds)
        ? d.pendingToolCallIds.map((id) => String(id))
        : [],
    }
    context.streamComplete = true
    return
  }

  if (kind === MothershipStreamV1RunKind.compaction_start) {
    addContentBlock(context, {
      type: 'tool_call',
      toolCall: {
        id: `compaction-${Date.now()}`,
        name: 'context_compaction',
        status: 'executing',
      },
    })
    return
  }

  if (kind === MothershipStreamV1RunKind.compaction_done) {
    addContentBlock(context, {
      type: 'tool_call',
      toolCall: {
        id: `compaction-${Date.now()}`,
        name: 'context_compaction',
        status: MothershipStreamV1ToolOutcome.success,
      },
    })
  }
}
