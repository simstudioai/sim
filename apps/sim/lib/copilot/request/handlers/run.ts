import { createLogger } from '@sim/logger'
import {
  MothershipStreamV1RunKind,
  MothershipStreamV1ToolOutcome,
} from '@/lib/copilot/generated/mothership-stream-v1'
import type { StreamHandler } from './types'
import { addContentBlock } from './types'

const logger = createLogger('CopilotRunHandler')

export const handleRunEvent: StreamHandler = (event, context) => {
  if (event.type !== 'run') {
    return
  }

  if (event.payload.kind === MothershipStreamV1RunKind.checkpoint_pause) {
    const frames = (event.payload.frames ?? []).map((frame) => ({
      parentToolCallId: frame.parentToolCallId,
      parentToolName: frame.parentToolName,
      pendingToolIds: frame.pendingToolIds,
    }))

    context.awaitingAsyncContinuation = {
      checkpointId: event.payload.checkpointId,
      executionId: event.payload.executionId || context.executionId,
      runId: event.payload.runId || context.runId,
      pendingToolCallIds: event.payload.pendingToolCallIds,
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

  if (event.payload.kind === MothershipStreamV1RunKind.compaction_start) {
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

  if (event.payload.kind === MothershipStreamV1RunKind.resumed) {
    context.awaitingAsyncContinuation = undefined
    context.streamComplete = false
    logger.info('Received run resumed event')
    return
  }

  if (event.payload.kind === MothershipStreamV1RunKind.compaction_done) {
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
