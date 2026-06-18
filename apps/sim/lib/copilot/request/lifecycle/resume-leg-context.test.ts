import { describe, expect, it } from 'vitest'
import { createStreamingContext } from '@/lib/copilot/request/context/request-context'
import { makeResumeLegContext, mergeResumeLegOutputs } from '@/lib/copilot/request/lifecycle/run'

// Guards the makeResumeLegContext / mergeResumeLegOutputs contract: the two MUST
// stay in lockstep (every per-leg-isolated scalar is reset on leg creation and
// folded back on merge), and the heavy accumulators stay shared by reference so
// all concurrent legs build one chat. This is the regression the inline comment
// warns about — without per-leg isolation the orchestrator's pre-fanout content
// gets multiplied by the leg count on merge.
describe('resume leg context isolate/merge contract', () => {
  it('isolates the per-leg scalars while sharing the heavy accumulators by reference', () => {
    const base = createStreamingContext({
      accumulatedContent: 'PRE',
      finalAssistantContent: 'PRE-FINAL',
      usage: { prompt: 10, completion: 5 },
      cost: { input: 1, output: 2, total: 3 },
      errors: ['pre-existing'],
    })

    const leg = makeResumeLegContext(base)

    // Per-leg scalars reset so a leg accumulates only its OWN output.
    expect(leg.accumulatedContent).toBe('')
    expect(leg.finalAssistantContent).toBe('')
    expect(leg.usage).toBeUndefined()
    expect(leg.cost).toBeUndefined()
    expect(leg.errors).toEqual([])
    expect(leg.streamComplete).toBe(false)
    expect(leg.awaitingAsyncContinuation).toBeUndefined()

    // A leg's own errors array is a fresh array (not the shared one) so a leg's
    // retry rollback can't truncate a sibling's errors.
    expect(leg.errors).not.toBe(base.errors)

    // Heavy accumulators stay shared by reference (one merged chat).
    expect(leg.contentBlocks).toBe(base.contentBlocks)
    expect(leg.toolCalls).toBe(base.toolCalls)
    expect(leg.pendingToolPromises).toBe(base.pendingToolPromises)
    expect(leg.subAgentContent).toBe(base.subAgentContent)
  })

  it('folds a leg back exactly once (no double-count of the orchestrator content)', () => {
    const base = createStreamingContext({ accumulatedContent: 'PRE', errors: ['pre'] })

    const leg = makeResumeLegContext(base)
    leg.accumulatedContent = 'JOIN'
    leg.finalAssistantContent = 'JOIN-FINAL'
    leg.usage = { prompt: 100, completion: 50 }
    leg.cost = { input: 4, output: 5, total: 9 }
    leg.errors.push('leg-err')

    mergeResumeLegOutputs(base, leg)

    // PRE seeded once + the leg's own output appended once — not PRE+PRE+JOIN.
    expect(base.accumulatedContent).toBe('PREJOIN')
    expect(base.finalAssistantContent).toBe('JOIN-FINAL')
    expect(base.usage).toEqual({ prompt: 100, completion: 50 })
    expect(base.cost).toEqual({ input: 4, output: 5, total: 9 })
    expect(base.errors).toEqual(['pre', 'leg-err'])
  })

  it('does not multiply pre-fanout content across many legs (N children + one join leg)', () => {
    const base = createStreamingContext({ accumulatedContent: 'PRE' })

    // Seven child legs that stream subagent content (not main accumulatedContent)
    // contribute nothing to the join scalars; only the join-carrying leg does.
    for (let i = 0; i < 7; i++) {
      const childLeg = makeResumeLegContext(base)
      mergeResumeLegOutputs(base, childLeg)
    }
    const joinLeg = makeResumeLegContext(base)
    joinLeg.accumulatedContent = 'SUMMARY'
    joinLeg.usage = { prompt: 1, completion: 1 }
    mergeResumeLegOutputs(base, joinLeg)

    // Exactly the pre-fanout content + the one join leg's summary — the 7 child
    // legs must not each re-append 'PRE'.
    expect(base.accumulatedContent).toBe('PRESUMMARY')
    expect(base.usage).toEqual({ prompt: 1, completion: 1 })
  })
})
