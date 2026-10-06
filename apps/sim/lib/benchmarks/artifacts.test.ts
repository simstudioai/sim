import { describe, expect, it } from 'vitest'
import {
  applyBenchmarkPatch,
  redactBenchmarkSpec,
  validateBenchmarkRedaction,
} from '@/lib/benchmarks/artifacts'
import type { BenchmarkArtifacts } from '@/lib/benchmarks/types'

const artifacts: BenchmarkArtifacts = {
  taskBrief: 'Describe escalation ownership.',
  referenceSpec: 'Support owns follow-up until Engineering accepts. Support monitors it.',
  redactedSpec:
    '[[BLANK:owner]] owns follow-up until Engineering accepts. [[BLANK:owner]] monitors it.',
  blanks: [{ id: 'owner', answer: 'Support' }],
  generatedSpec: 'Support owns follow-up until Engineering accepts.',
  reconstruction: [{ id: 'owner', answer: 'Support', support: 'Support owns follow-up' }],
  grade: [{ id: 'owner', correct: true, reason: 'Supported.' }],
}

describe('benchmark reference integrity', () => {
  it('builds masks from exact selected passages without rewriting the reference', () => {
    const referenceSpec = 'Queue: Ops [L2].\nNotify Ops [L2] and team+$ at $5.\n'
    expect(
      redactBenchmarkSpec(referenceSpec, [
        { id: 'queue', answer: 'Ops [L2]' },
        { id: 'team', answer: 'team+$' },
      ])
    ).toBe('Queue: [[BLANK:queue]].\nNotify [[BLANK:queue]] and [[BLANK:team]] at $5.\n')
  })

  it('rejects missing, duplicate, or overlapping passages that cannot produce every blank', () => {
    for (const blanks of [
      [{ id: 'missing', answer: 'Elsewhere' }],
      [
        { id: 'first', answer: 'Support' },
        { id: 'second', answer: 'Support' },
      ],
      [
        { id: 'short', answer: 'Support' },
        { id: 'long', answer: 'Support team' },
      ],
    ]) {
      expect(() => redactBenchmarkSpec('Support team owns follow-up.', blanks)).toThrow()
    }
  })

  it('accepts repeated masks for one requirement without changing surviving reference text', () => {
    expect(() => validateBenchmarkRedaction(artifacts)).not.toThrow()
  })

  it('rejects a redaction that quietly changes an unmasked requirement', () => {
    expect(() =>
      validateBenchmarkRedaction({ ...artifacts, redactedSpec: '[[BLANK:owner]] owns everything.' })
    ).toThrow()
  })

  it('rejects unscored masks and duplicate answer identifiers', () => {
    const firstBlank = artifacts.blanks[0]
    if (!firstBlank) throw new Error('Missing blank fixture')
    expect(() =>
      validateBenchmarkRedaction({ ...artifacts, redactedSpec: '[[BLANK:unknown]]' })
    ).toThrow()
    expect(() =>
      validateBenchmarkRedaction({
        ...artifacts,
        blanks: [...artifacts.blanks, firstBlank],
      })
    ).toThrow()
  })

  it('invalidates the target-dependent artifacts when the reference changes', () => {
    const result = applyBenchmarkPatch(artifacts, {
      referenceSpec: 'Engineering owns the escalation.',
    })
    expect(result).toEqual({
      ...artifacts,
      referenceSpec: 'Engineering owns the escalation.',
      redactedSpec: '',
      blanks: [],
      generatedSpec: null,
      reconstruction: null,
      grade: null,
    })
  })

  it('preserves the generated plan when only masks change and clears its old score', () => {
    const result = applyBenchmarkPatch(artifacts, {
      redactedSpec: 'Support owns follow-up until [[BLANK:handoff]]. Support monitors it.',
      blanks: [{ id: 'handoff', answer: 'Engineering accepts' }],
    })
    expect(result.generatedSpec).toBe(artifacts.generatedSpec)
    expect(result.reconstruction).toBeNull()
    expect(result.grade).toBeNull()
  })
})

it('rejects reserved blank syntax when importing an unredacted reference', () => {
  expect(() =>
    applyBenchmarkPatch(artifacts, { referenceSpec: 'Keep [[BLANK:example]] literally.' })
  ).toThrow('reserved')
})
