import { createLogger } from '@sim/logger'
import {
  MothershipStreamV1RunKind,
  MothershipStreamV1ToolOutcome,
} from '@/lib/copilot/generated/mothership-stream-v1'
import { getEventData } from '@/lib/copilot/request/sse-utils'
import type { StreamHandler } from './types'
import { addContentBlock } from './types'

const logger = createLogger('CopilotRunHandler')

export const handleRunEvent: StreamHandler = (event, context) => {
  const d = getEventData(event)
  if (!d) return

  const kind = d?.kind as string | undefined

  if (kind === MothershipStreamV1RunKind.checkpoint_pause) {
    const rawFrames = Array.isArray(d?.frames) ? d.frames : []
    const frames = rawFrames.map((f: Record<string, unknown>) => ({
      parentToolCallId: String(f.parentToolCallId),
      parentToolName: String(f.parentToolName ?? ''),
      pendingToolIds: Array.isArray(f.pendingToolIds)
        ? f.pendingToolIds.map((id: unknown) => String(id))
        : [],
    }))

    context.awaitingAsyncContinuation = {
      checkpointId: String(d?.checkpointId),
      executionId: typeof d?.executionId === 'string' ? d.executionId : context.executionId,
      runId: typeof d?.runId === 'string' && d.runId ? d.runId : context.runId,
      pendingToolCallIds: Array.isArray(d?.pendingToolCallIds)
        ? d.pendingToolCallIds.map((id) => String(id))
        : [],
      frames: frames.length > 0 ? frames : undefined,
    }
    logger.info('Received checkpoint pause', {
      checkpointId: context.awaitingAsyncContinuation.checkpointId,
      executionId: context.awaitingAsyncContinuation.executionId,
      runId: context.awaitingAsyncContinuation.runId,
      pendingToolCallIds: context.awaitingAsyncContinuation.pendingToolCallIds,
      frameCount: frames.length,
    })
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
