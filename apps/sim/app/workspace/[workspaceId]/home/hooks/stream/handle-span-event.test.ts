import { describe, expect, it } from 'vitest'
import type { PersistedStreamEventEnvelope } from '@/lib/mothership/request/session/contract'
import { handleCompleteEvent } from './handle-complete-event'
import { createStreamLoopContext } from './stream-context'
import { makeStreamLoopDeps } from './stream-test-helpers'

describe('browser subagent span activity', () => {
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
})
