/**
 * @vitest-environment node
 *
 * Failure mode: a fork cuts at, or copies, a steering message no turn applied. The
 * worker has no input event for it (its cut 404s), and in the copy nothing can ever
 * deliver it, so it would end as a dead bubble.
 */
import { describe, expect, it } from 'vitest'
import { withoutUnappliedSteering } from '@/lib/mothership/chat/steering'

const turn = { id: 'turn' }
const answerApplying = (steeringId: string) => ({
  id: 'answer',
  contentBlocks: [{ steering: { steeringId } }],
})

describe('withoutUnappliedSteering', () => {
  it('drops a steering message no turn applied', () => {
    const unapplied = { id: 'held', steering: { streamId: 'turn' } }
    expect(withoutUnappliedSteering([turn, unapplied, { id: 'answer' }])).toEqual([
      turn,
      { id: 'answer' },
    ])
  })

  it('keeps one a kept turn applied', () => {
    const applied = { id: 'held', steering: { streamId: 'turn' } }
    const messages = [turn, applied, answerApplying('held')]
    expect(withoutUnappliedSteering(messages)).toEqual(messages)
  })

  it('drops one whose applying answer is past the cut', () => {
    const applied = { id: 'held', steering: { streamId: 'turn' } }
    expect(withoutUnappliedSteering([turn, applied])).toEqual([turn])
  })

  it("keeps a row re-marked as a turn's own message", () => {
    const remarked = { id: 'own', steering: { streamId: 'own' } }
    expect(withoutUnappliedSteering([remarked])).toEqual([remarked])
  })
})
