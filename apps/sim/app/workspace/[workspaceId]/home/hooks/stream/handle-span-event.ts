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

/**
 * Side effects for subagent span lifecycle. The model owns the subagent
 * group/nesting/close (via `reduceEvent`); this handler only seeds the file
 * preview session on a fresh file-subagent start and reconciles the file
 * resource chrome on end, then flushes the model-derived snapshot.
 */
export function handleSpanEvent(
  ctx: StreamLoopContext,
  parsed: SpanEvent,
  scope: StreamEventScope
): void {
  const { state, ops, deps } = ctx
  const { scopedParentToolCallId, scopedAgentId, scopedSpanId } = scope
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

  if (payload.event === MothershipStreamV1SpanLifecycleEvent.start && name === FILE_SUBAGENT_ID) {
    // Seed the pending preview session only on a freshly-opened lane (the agent
    // node was created by this event), so concurrent file subagents don't re-seed.
    const node = scopedSpanId ? state.model.nodes.get(scopedSpanId) : undefined
    const isNewLane = node?.kind === 'agent' && node.seq === parsed.seq
    if (isNewLane) {
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
    ops.flush()
  }
}
