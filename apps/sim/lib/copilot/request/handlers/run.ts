import { createLogger } from '@sim/logger'
import { generateShortId } from '@sim/utils/id'
import {
  MothershipStreamV1RunKind,
  MothershipStreamV1ToolOutcome,
} from '@/lib/copilot/generated/mothership-stream-v1'
import type { ContentBlock, StreamEvent, StreamingContext } from '@/lib/copilot/request/types'
import type { StreamHandler } from './types'
import { addContentBlock, getScopedSpanIdentity } from './types'

const logger = createLogger('CopilotRunHandler')
const CONTEXT_COMPACTION_TOOL = 'context_compaction'

function isSameCompactionLane(block: ContentBlock, event: StreamEvent): boolean {
  const spanId = event.scope?.spanId
  if (spanId) return block.spanId === spanId

  const parentToolCallId = event.scope?.parentToolCallId
  if (parentToolCallId) return block.parentToolCallId === parentToolCallId

  return !block.spanId && !block.parentToolCallId && !block.calledBy
}

function findActiveCompactionBlock(
  context: StreamingContext,
  event: StreamEvent
): ContentBlock | undefined {
  for (let i = context.contentBlocks.length - 1; i >= 0; i--) {
    const block = context.contentBlocks[i]
    if (
      block.type === 'tool_call' &&
      block.toolCall?.name === CONTEXT_COMPACTION_TOOL &&
      block.toolCall.status === 'executing' &&
      isSameCompactionLane(block, event)
    ) {
      return block
    }
  }
  return undefined
}

function addCompactionBlock(
  context: StreamingContext,
  event: StreamEvent,
  status: 'executing' | typeof MothershipStreamV1ToolOutcome.success
): void {
  const now = Date.now()
  const parentToolCallId = event.scope?.parentToolCallId
  const calledBy =
    (parentToolCallId ? context.toolCalls.get(parentToolCallId)?.name : undefined) ??
    event.scope?.agentId
  addContentBlock(context, {
    type: 'tool_call',
    toolCall: {
      id: `compaction-${generateShortId()}`,
      name: CONTEXT_COMPACTION_TOOL,
      status,
      startTime: now,
      ...(status === MothershipStreamV1ToolOutcome.success ? { endTime: now } : {}),
    },
    ...(calledBy ? { calledBy } : {}),
    ...(parentToolCallId ? { parentToolCallId } : {}),
    ...getScopedSpanIdentity(event),
    ...(status === MothershipStreamV1ToolOutcome.success ? { endedAt: now } : {}),
  })
}

export const handleRunEvent: StreamHandler = (event, context) => {
  if (event.type !== 'run') {
    return
  }

  if (event.payload.kind === MothershipStreamV1RunKind.checkpoint_pause) {
    const frames = (event.payload.frames ?? []).map((frame) => ({
      parentToolCallId: frame.parentToolCallId,
      parentToolName: frame.parentToolName,
      pendingToolIds: frame.pendingToolIds,
      // Carried through for the per-subagent resume fan-out; undefined under the
      // legacy bundled-frame model (all frames share the top-level checkpointId).
      ...(frame.checkpointId ? { checkpointId: frame.checkpointId } : {}),
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
    if (!findActiveCompactionBlock(context, event)) {
      addCompactionBlock(context, event, 'executing')
    }
    return
  }

  if (event.payload.kind === MothershipStreamV1RunKind.resumed) {
    context.awaitingAsyncContinuation = undefined
    context.streamComplete = false
    logger.info('Received run resumed event')
    return
  }

  if (event.payload.kind === MothershipStreamV1RunKind.compaction_done) {
    const active = findActiveCompactionBlock(context, event)
    if (!active?.toolCall) {
      addCompactionBlock(context, event, MothershipStreamV1ToolOutcome.success)
      return
    }

    const now = Date.now()
    active.toolCall.status = MothershipStreamV1ToolOutcome.success
    active.toolCall.endTime = now
    active.endedAt = now
  }
}
