import { describe, expect, it } from 'vitest'
import { gradeReconstruction, validateReconstruction } from '@/lib/benchmarks/evaluation'

/** These checks protect the LLM boundary: complete IDs, a fixed denominator, and quoted evidence. */
describe('benchmark reconstruction grading', () => {
  const blanks = [
    { id: 'owner', answer: 'Support' },
    { id: 'handoff', answer: 'acceptance' },
  ]
  const reconstructed = [
    { id: 'owner', answer: 'Support', support: 'Support owns the escalation.' },
    { id: 'handoff', answer: 'acceptance', support: '' },
  ]

  it.each([
    reconstructed.slice(0, 1),
    [reconstructed[0], reconstructed[0]],
    [reconstructed[0], { ...reconstructed[1], id: 'foreign' }],
  ])(
    'rejects omitted, duplicate, or foreign answers instead of changing the denominator',
    (answers) => {
      expect(() => validateReconstruction(blanks, answers)).toThrow()
    }
  )

  it('gives no credit for a correct guess without a supporting passage', () => {
    const result = gradeReconstruction({
      blanks,
      reconstruction: reconstructed,
      generatedSpec: 'Support owns the escalation.',
      judgments: blanks.map(({ id }) => ({ id, correct: true, reason: 'Equivalent answer.' })),
    })
    expect(result.map(({ correct }) => correct)).toEqual([true, false])
  })

  it('gives no credit when the reader fabricates its supporting passage', () => {
    const result = gradeReconstruction({
      blanks,
      reconstruction: reconstructed,
      generatedSpec: 'Engineering owns the escalation.',
      judgments: blanks.map(({ id }) => ({ id, correct: true, reason: 'Equivalent answer.' })),
    })
    expect(result.every(({ correct }) => !correct)).toBe(true)
  })

  it('keeps an answer available for review without crediting unverified source evidence', () => {
    const result = gradeReconstruction({
      blanks,
      reconstruction: reconstructed.map((answer) => ({
        ...answer,
        evidenceError: 'Source quote was not retrieved.',
      })),
      generatedSpec: 'Support owns the escalation.',
      judgments: blanks.map(({ id }) => ({ id, correct: true, reason: 'Equivalent answer.' })),
    })
    expect(result[0]).toMatchObject({ correct: false, reason: 'Source quote was not retrieved.' })
  })

  it('rejects an incomplete judge response instead of silently passing ungraded answers', () => {
    expect(() =>
      gradeReconstruction({
        blanks,
        reconstruction: reconstructed,
        generatedSpec: 'Support owns the escalation.',
        judgments: [{ id: 'owner', correct: true, reason: 'Equivalent answer.' }],
      })
    ).toThrow()
  })

  it('rejects a missing mechanic even when an external source supplies the expected answer', () => {
    const spec = 'Use the Sim repository for issue intake.'
    const result = gradeReconstruction({
      blanks: [{ id: 'handoff', answer: 'Engineering accepts the case' }],
      reconstruction: [
        {
          id: 'handoff',
          answer: 'Engineering accepts the case',
          support: spec,
          sources: [{ citationId: 'repo', quote: 'Engineering accepts the case' }],
        },
      ],
      generatedSpec: spec,
      judgments: [
        {
          id: 'handoff',
          correct: true,
          basis: 'missing',
          reason: 'The repository document describes the handoff, but the plan omits it.',
        },
      ],
    })
    expect(result[0].correct).toBe(false)
  })
})
