import type { PersistedStreamEventEnvelope } from '@/lib/mothership/request/session/contract'
import { getChatResourceKey } from '@/lib/mothership/resources/types'
import type { StreamLoopContext } from '@/app/workspace/[workspaceId]/home/hooks/stream/stream-context'

type CompleteEvent = Extract<PersistedStreamEventEnvelope, { type: 'complete' }>

/**
 * Turn termination and the deterministic propagation of the outcome to any
 * still-open node are folded into the model by `reduceEvent` (which skips an
 * async pause). Search evidence stays in the answer; completion only removes
 * interim search resources that the user has not opened.
 */
export function handleCompleteEvent(ctx: StreamLoopContext, parsed: CompleteEvent): void {
  ctx.deps.clearBrowserAgentRuns()
  ctx.state.browserAgentRunIds.clear()
  ctx.state.sawCompleteEvent = true
  ctx.state.completionStatus = parsed.payload.status ?? null
  ctx.ops.flush()
  if (!ctx.deps.citedSourcesEnabled || ctx.deps.options.deferFlushes || ctx.ops.isStale()) return
  const streamedSearch = ctx.state.liveSearchResource
  const wasVisible =
    streamedSearch &&
    ctx.deps.resourcesRef.current.some(
      (item) => getChatResourceKey(item) === getChatResourceKey(streamedSearch)
    )
  if (streamedSearch && !wasVisible) {
    ctx.deps.removeResource('search', streamedSearch.id, streamedSearch.workspaceId)
  }
}
