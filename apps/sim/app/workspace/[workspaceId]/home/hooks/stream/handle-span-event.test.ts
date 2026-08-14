/**
 * @vitest-environment node
 */
import { describe, expect, it } from 'vitest'
import {
  MothershipStreamV1SpanLifecycleEvent,
  MothershipStreamV1SpanPayloadKind,
} from '@/lib/copilot/generated/mothership-stream-v1'
import type { PersistedStreamEventEnvelope } from '@/lib/copilot/request/session/contract'
import { handleCompleteEvent } from './handle-complete-event'
import { handleSpanEvent } from './handle-span-event'
import { createStreamLoopContext } from './stream-context'
import { makeStreamLoopDeps } from './stream-test-helpers'

function spanEvent(
  event: MothershipStreamV1SpanLifecycleEvent,
  agent = 'browser'
): Extract<PersistedStreamEventEnvelope, { type: 'span' }> {
  return {
    v: 1,
    seq: event === MothershipStreamV1SpanLifecycleEvent.start ? 1 : 2,
    ts: '2026-01-01T00:00:00Z',
    stream: { streamId: 'stream-1' },
    type: 'span',
    payload: {
      kind: MothershipStreamV1SpanPayloadKind.subagent,
      event,
      agent,
      data: { tool_call_id: 'browser-call-1' },
    },
  } as Extract<PersistedStreamEventEnvelope, { type: 'span' }>
}

describe('browser subagent span activity', () => {
  it('stays active for the whole browser span, independently of tool calls', () => {
    const deps = makeStreamLoopDeps()
    const ctx = createStreamLoopContext(deps)
    const scope = {
      scopedParentToolCallId: 'browser-call-1',
      scopedAgentId: 'browser',
      scopedSpanId: 'browser-span-1',
    }

    handleSpanEvent(ctx, spanEvent(MothershipStreamV1SpanLifecycleEvent.start), scope)

    expect(ctx.state.browserAgentRunIds).toEqual(new Set(['browser-span-1']))
    expect(deps.startBrowserAgentRun).toHaveBeenCalledWith('browser-span-1')
    expect(deps.endBrowserAgentRun).not.toHaveBeenCalled()

    handleSpanEvent(ctx, spanEvent(MothershipStreamV1SpanLifecycleEvent.end), scope)

    expect(ctx.state.browserAgentRunIds.size).toBe(0)
    expect(deps.endBrowserAgentRun).toHaveBeenCalledWith('browser-span-1')
  })

  it('clears a browser span when the stream completes without an explicit end', () => {
    const deps = makeStreamLoopDeps()
    const ctx = createStreamLoopContext(deps)
    ctx.state.browserAgentRunIds.add('browser-span-1')

    handleCompleteEvent(ctx, {
      v: 1,
      seq: 2,
      ts: '2026-01-01T00:00:01Z',
      stream: { streamId: 'stream-1' },
      type: 'complete',
      payload: { status: 'complete' },
    } as Extract<PersistedStreamEventEnvelope, { type: 'complete' }>)

    expect(ctx.state.browserAgentRunIds.size).toBe(0)
    expect(deps.clearBrowserAgentRuns).toHaveBeenCalledOnce()
  })

  it('does not mark other subagents as browser activity', () => {
    const deps = makeStreamLoopDeps()
    const ctx = createStreamLoopContext(deps)

    handleSpanEvent(ctx, spanEvent(MothershipStreamV1SpanLifecycleEvent.start, 'workflow'), {
      scopedParentToolCallId: 'workflow-call-1',
      scopedAgentId: 'workflow',
      scopedSpanId: 'workflow-span-1',
    })

    expect(ctx.state.browserAgentRunIds.size).toBe(0)
    expect(deps.startBrowserAgentRun).not.toHaveBeenCalled()
  })
})
