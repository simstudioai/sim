import type { PersistedStreamEventEnvelope } from '@/lib/mothership/request/session/contract'
import { collectCitedMessageSources } from '@/app/workspace/[workspaceId]/home/components/message-content/message-sources'
import type { StreamLoopContext } from '@/app/workspace/[workspaceId]/home/hooks/stream/stream-context'

type CompleteEvent = Extract<PersistedStreamEventEnvelope, { type: 'complete' }>

/**
 * Turn termination and the deterministic propagation of the outcome to any
 * still-open node are folded into the model by `reduceEvent` (which skips an
 * async pause). A successful live-search answer publishes only its cited evidence
 * after that final flush; a citation-free answer leaves panel state untouched.
 */
export function handleCompleteEvent(ctx: StreamLoopContext, parsed: CompleteEvent): void {
  ctx.deps.clearBrowserAgentRuns()
  ctx.state.browserAgentRunIds.clear()
  ctx.state.sawCompleteEvent = true
  ctx.state.completionStatus = parsed.payload.status ?? null
  ctx.ops.flush()
  if (
    !ctx.deps.citedSourcesEnabled ||
    parsed.payload.status !== 'complete' ||
    ctx.state.sawStreamError ||
    ctx.deps.options.deferFlushes ||
    ctx.ops.isStale()
  )
    return
  const sources = collectCitedMessageSources(
    ctx.deps.streamingBlocksRef.current,
    ctx.deps.streamingContentRef.current
  )
  if (!sources.length) return
  const resource = {
    type: 'sources' as const,
    id: 'cited-sources',
    title: 'Sources',
    sources: {
      messageId: ctx.deps.assistantId,
      ...(ctx.state.streamRequestId ? { requestId: ctx.state.streamRequestId } : {}),
    },
  }
  ctx.deps.addResource(resource)
  ctx.deps.onResourceEventRef.current?.(resource.id, { revealCitedSources: true })
}
