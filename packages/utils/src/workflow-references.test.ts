import {
  findWorkflowReferenceTokens,
  isLikelyWorkflowReferenceSegment,
  splitWorkflowReferenceSegment,
  type WorkflowReferenceToken,
} from '@sim/utils/workflow-references'
import { describe, expect, it } from 'vitest'

describe('workflow references', () => {
  it('distinguishes references from comparisons and numeric angle brackets', () => {
    expect(isLikelyWorkflowReferenceSegment('<block.output>')).toBe(true)
    expect(isLikelyWorkflowReferenceSegment('<parameter>')).toBe(true)
    expect(isLikelyWorkflowReferenceSegment('< limit && total >')).toBe(false)
    expect(isLikelyWorkflowReferenceSegment('<123>')).toBe(false)
  })

  it('rejects compact boolean and nested comparison expressions', () => {
    expect(findWorkflowReferenceTokens('value <limit && value>max')).toEqual([])
    expect(findWorkflowReferenceTokens('value<limit||value>max')).toEqual([])
    expect(findWorkflowReferenceTokens('a<b<c>d')).toEqual([])
  })

  it('scans long runs of opening brackets while preserving final reference offsets', () => {
    expect(findWorkflowReferenceTokens(`${'<'.repeat(10_000)}value>`)).toEqual([
      {
        kind: 'workflow',
        value: '<value>',
        start: 9_999,
        end: 10_006,
      },
    ])
    expect(findWorkflowReferenceTokens(`${'<'.repeat(10_000)}<block.output>`)).toEqual([
      {
        kind: 'workflow',
        value: '<block.output>',
        start: 10_000,
        end: 10_014,
      },
    ])
  })

  it('drops a reference that overlaps an env token, on either side', () => {
    expect(findWorkflowReferenceTokens('{{<a.b>}} <c.d> <e.{{K}}> {{K}}<f.g>')).toEqual([
      { kind: 'environment', value: '{{<a.b>}}', start: 0, end: 9 },
      { kind: 'workflow', value: '<c.d>', start: 10, end: 15 },
      { kind: 'environment', value: '{{K}}', start: 19, end: 24 },
      { kind: 'environment', value: '{{K}}', start: 26, end: 31 },
      { kind: 'workflow', value: '<f.g>', start: 31, end: 36 },
    ])
  })

  it('matches the all-pairs overlap scan on mixed and overlapping inputs', () => {
    const pieces = ['<', '>', '.', 'a', ' ', '{{', '}}', '{', 'K', '\n', '=', '<a.b>', '{{K}}']
    pieces.push('{{<a.b>}}', '<a.{{K}}>', '<<a.b>', 'x<y', '<a.b>>')
    let seed = 7
    const next = (bound: number) => {
      seed = (seed * 1_103_515_245 + 12_345) % 2_147_483_648
      return seed % bound
    }
    for (let run = 0; run < 3_000; run++) {
      let source = ''
      for (let n = next(40); n > 0; n--) source += pieces[next(pieces.length)]
      expect(findWorkflowReferenceTokens(source)).toEqual(allPairsTokens(source))
    }
  })

  it('finds every reference and env token in a long mixed input', () => {
    // 160k tokens: the all-pairs scan this replaced takes far past the test timeout here.
    const tokens = findWorkflowReferenceTokens('<a.b>{{K}}'.repeat(80_000))
    expect(tokens).toHaveLength(160_000)
  })
})

/** The scan with every accepted token checked against every earlier one, as it was written first. */
function allPairsTokens(source: string): WorkflowReferenceToken[] {
  const tokens: WorkflowReferenceToken[] = []
  for (const match of source.matchAll(/\{\{[^{}\r\n]+\}\}/g)) {
    const start = match.index
    tokens.push({ kind: 'environment', value: match[0], start, end: start + match[0].length })
  }
  let candidateStart = -1
  for (let index = 0; index < source.length; index += 1) {
    const character = source[index]
    if (character === '<' && candidateStart === -1) {
      candidateStart = index
      continue
    }
    if (character === '\r' || character === '\n') {
      candidateStart = -1
      continue
    }
    if (character !== '>' || candidateStart === -1) continue
    const candidate = source.slice(candidateStart, index + 1)
    const split = splitWorkflowReferenceSegment(candidate)
    if (split && isLikelyWorkflowReferenceSegment(candidate)) {
      const start = candidateStart + split.leading.length
      const end = start + split.reference.length
      if (!tokens.some((token) => start < token.end && end > token.start)) {
        tokens.push({ kind: 'workflow', value: split.reference, start, end })
      }
    }
    candidateStart = -1
  }
  return tokens.sort((left, right) => left.start - right.start)
}
