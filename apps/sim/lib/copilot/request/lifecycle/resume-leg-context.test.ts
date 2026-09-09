import { describe, expect, it, vi } from 'vitest'
import { MothershipStreamV1CompletionStatus } from '@/lib/copilot/generated/mothership-stream-v1'
import { createStreamingContext } from '@/lib/copilot/request/context/request-context'
import {
  createProviderToolCallIdentity,
  restoreProviderToolCallId,
  scopeProviderToolCallId,
} from '@/lib/copilot/request/go/tool-call-identity'

/** Table side effects are not exercised here, and the real module loads the table application layer. */
vi.mock('@/lib/copilot/request/tools/tables', () => ({
  maybeWriteOutputToTable: vi.fn(async (_toolName, _params, result) => result),
  maybeWriteReadCsvToTable: vi.fn(async (_toolName, _params, result) => result),
}))

import { makeResumeLegContext, mergeResumeLegOutputs } from '@/lib/copilot/request/lifecycle/run'

// Guards the makeResumeLegContext / mergeResumeLegOutputs contract: the two MUST
// stay in lockstep (every per-leg-isolated scalar is reset on leg creation and
// folded back on merge), and the heavy accumulators stay shared by reference so
// all concurrent legs build one chat. This is the regression the inline comment
// warns about — without per-leg isolation the orchestrator's pre-fanout content
// gets multiplied by the leg count on merge.
//
// `wasAborted` is the one deliberate exception to "reset AND folded back": it is
// reset per leg but folded back only for a turn-level abort, because a fanout
// cancelling its own lanes must not mark the shared turn aborted.
describe('resume leg context isolate/merge contract', () => {
  it('shares provider identity mappings across sibling legs and retries', () => {
    const identity = createProviderToolCallIdentity('run-1')
    const base = createStreamingContext({ providerToolCallIdentity: identity })
    const first = makeResumeLegContext(base)
    const second = makeResumeLegContext(base)
    const canonicalId = scopeProviderToolCallId('child-call', identity)

    expect(first.providerToolCallIdentity).toBe(identity)
    expect(second.providerToolCallIdentity).toBe(identity)
    expect(restoreProviderToolCallId(canonicalId, second.providerToolCallIdentity)).toBe(
      'child-call'
    )
    expect(scopeProviderToolCallId('child-call', identity)).toBe(canonicalId)
    expect(makeResumeLegContext(createStreamingContext()).providerToolCallIdentity).toBeUndefined()
  })

  it('isolates the per-leg scalars while sharing the heavy accumulators by reference', () => {
    const base = createStreamingContext({
      accumulatedContent: 'PRE',
      finalAssistantContent: 'PRE-FINAL',
      usage: { prompt: 10, completion: 5 },
      cost: { input: 1, output: 2, total: 3 },
      errors: ['pre-existing'],
      completionStatus: MothershipStreamV1CompletionStatus.complete,
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
    expect(leg.completionStatus).toBeUndefined()
    // A leg must never be born aborted — that is what let one cancelled lane
    // cancel every tool dispatched on every lane created after it.
    expect(leg.wasAborted).toBe(false)

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
    leg.completionStatus = MothershipStreamV1CompletionStatus.complete

    mergeResumeLegOutputs(base, leg)

    // PRE seeded once + the leg's own output appended once — not PRE+PRE+JOIN.
    expect(base.accumulatedContent).toBe('PREJOIN')
    expect(base.finalAssistantContent).toBe('JOIN-FINAL')
    expect(base.usage).toEqual({ prompt: 100, completion: 50 })
    expect(base.cost).toEqual({ input: 4, output: 5, total: 9 })
    expect(base.errors).toEqual(['pre', 'leg-err'])
    expect(base.completionStatus).toBe(MothershipStreamV1CompletionStatus.complete)
  })

  it('does not fold a fanout-induced abort onto the shared turn', () => {
    // A lane that fails cancels its siblings by design, and each cancelled
    // sibling returns normally with wasAborted set. Folding that marked the
    // SHARED context aborted, so every leg created afterwards was born aborted
    // and every tool it dispatched was cancelled before dispatch — which the
    // subagent join then reported as a fatal "missing result".
    const base = createStreamingContext({})
    const leg = makeResumeLegContext(base)
    leg.wasAborted = true

    mergeResumeLegOutputs(base, leg, false)

    expect(base.wasAborted).toBe(false)
  })

  it('folds a turn-level abort onto the shared turn', () => {
    // The other half: a real Stop (or an observed abort marker) must reach the
    // shared context, because that is what classifies the request as cancelled
    // rather than successful.
    const base = createStreamingContext({})
    const leg = makeResumeLegContext(base)
    leg.wasAborted = true

    mergeResumeLegOutputs(base, leg, true)

    expect(base.wasAborted).toBe(true)
  })

  it('leaves the turn unfinished when only child legs fold back', () => {
    const base = createStreamingContext()

    // A child leg that folds with a terminal pause never carries the turn's
    // terminal event, so it must not report the turn as finished.
    const childLeg = makeResumeLegContext(base)
    childLeg.errors.push('subagent failed')
    mergeResumeLegOutputs(base, childLeg)

    expect(base.completionStatus).toBeUndefined()
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
