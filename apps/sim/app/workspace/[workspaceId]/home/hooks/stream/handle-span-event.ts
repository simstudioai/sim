import {
  MothershipStreamV1SpanLifecycleEvent,
  MothershipStreamV1SpanPayloadKind,
} from '@/lib/copilot/generated/mothership-stream-v1'
import type { PersistedStreamEventEnvelope } from '@/lib/copilot/request/session/contract'
import type {
  StreamEventScope,
  StreamLoopContext,
} from '@/app/workspace/[workspaceId]/home/hooks/stream/stream-context'
import {
  asPayloadRecord,
  FILE_SUBAGENT_ID,
} from '@/app/workspace/[workspaceId]/home/hooks/stream/stream-helpers'

type SpanEvent = Extract<PersistedStreamEventEnvelope, { type: 'span' }>

export function handleSpanEvent(
  ctx: StreamLoopContext,
  parsed: SpanEvent,
  scope: StreamEventScope
): void {
  const { state, ops, deps } = ctx
  const { scopedParentToolCallId, scopedAgentId, scopedSpanId, spanIdentity } = scope
  const payload = parsed.payload
  if (payload.kind !== MothershipStreamV1SpanPayloadKind.subagent) {
    return
  }
  const spanData = asPayloadRecord(payload.data)
  const parentToolCallIdFromData =
    typeof spanData?.tool_call_id === 'string'
      ? spanData.tool_call_id
      : typeof spanData?.toolCallId === 'string'
        ? spanData.toolCallId
        : undefined
  const parentToolCallId = scopedParentToolCallId ?? parentToolCallIdFromData
  const isPendingPause = spanData?.pending === true
  const name = typeof payload.agent === 'string' ? payload.agent : scopedAgentId

  if (payload.event === MothershipStreamV1SpanLifecycleEvent.start && name) {
    const existingOpenForSpan = scopedSpanId
      ? state.blocks.some(
          (b) => b.type === 'subagent' && b.spanId === scopedSpanId && b.endedAt === undefined
        )
      : false
    const isSameActiveSubagent =
      existingOpenForSpan ||
      (!scopedSpanId &&
        state.activeSubagent === name &&
        Boolean(state.activeSubagentParentToolCallId) &&
        parentToolCallId === state.activeSubagentParentToolCallId)
    if (scopedSpanId) {
      state.subagentBySpanId.set(scopedSpanId, name)
    }
    if (parentToolCallId) {
      state.subagentByParentToolCallId.set(parentToolCallId, name)
    }
    state.activeSubagent = name
    state.activeSubagentParentToolCallId = parentToolCallId
    if (!isSameActiveSubagent) {
      ops.stampBlockEnd(state.blocks[state.blocks.length - 1])
      state.blocks.push({
        type: 'subagent',
        content: name,
        ...(parentToolCallId ? { parentToolCallId } : {}),
        ...spanIdentity,
        timestamp: Date.now(),
      })
    }
    if (name === FILE_SUBAGENT_ID && !isSameActiveSubagent) {
      deps.applyPreviewSessionUpdate({
        schemaVersion: 1,
        id: parentToolCallId || 'file-preview',
        streamId: deps.streamIdRef.current ?? '',
        toolCallId: parentToolCallId || 'file-preview',
        status: 'pending',
        fileName: '',
        previewText: '',
        previewVersion: 0,
        updatedAt: new Date().toISOString(),
      })
    }
    ops.flush()
    return
  }

  if (payload.event === MothershipStreamV1SpanLifecycleEvent.end) {
    if (isPendingPause) {
      return
    }
    if (scopedSpanId) {
      state.subagentBySpanId.delete(scopedSpanId)
    }
    if (parentToolCallId) {
      state.subagentByParentToolCallId.delete(parentToolCallId)
    }
    if (
      deps.previewSessionRef.current &&
      (!deps.activePreviewSessionIdRef.current ||
        deps.previewSessionRef.current.status === 'complete')
    ) {
      const lastFileResource = deps.resourcesRef.current.find(
        (r) => r.type === 'file' && r.id !== 'streaming-file'
      )
      deps.setResources((rs) => rs.filter((r) => r.id !== 'streaming-file'))
      if (lastFileResource) {
        deps.setActiveResourceId(lastFileResource.id)
      }
    }
    if (
      !parentToolCallId ||
      parentToolCallId === state.activeSubagentParentToolCallId ||
      name === state.activeSubagent
    ) {
      state.activeSubagent = undefined
      state.activeSubagentParentToolCallId = undefined
    }
    const endNow = Date.now()
    if (scopedSpanId) {
      for (let i = state.blocks.length - 1; i >= 0; i--) {
        const b = state.blocks[i]
        if (b.type === 'subagent' && b.spanId === scopedSpanId && b.endedAt === undefined) {
          b.endedAt = endNow
          break
        }
      }
    } else if (name) {
      for (let i = state.blocks.length - 1; i >= 0; i--) {
        const b = state.blocks[i]
        if (
          b.type === 'subagent' &&
          b.content === name &&
          b.endedAt === undefined &&
          (!parentToolCallId || b.parentToolCallId === parentToolCallId)
        ) {
          b.endedAt = endNow
          break
        }
      }
    }
    ops.stampBlockEnd(state.blocks[state.blocks.length - 1])
    state.blocks.push({
      type: 'subagent_end',
      ...(parentToolCallId ? { parentToolCallId } : {}),
      ...spanIdentity,
      timestamp: endNow,
    })
    ops.flush()
  }
}
