import {
  findWorkflowReferenceTokens,
  isLikelyWorkflowReferenceSegment,
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

  it.each([
    [
      '<before.x>{{<hidden.x><alsoHidden.y>}}<after.y>',
      ['<before.x>', '{{<hidden.x><alsoHidden.y>}}', '<after.y>'],
    ],
    ['<before.x><{{ENV}}.value><after.y>', ['<before.x>', '{{ENV}}', '<after.y>']],
    ['{{ONE}}{{TWO}}<after.y>', ['{{ONE}}', '{{TWO}}', '<after.y>']],
    ['{{outer{{<hidden.x>}}}}<after.y>', ['{{<hidden.x>}}', '<after.y>']],
    ['{{<first.x>\n<second.y>}}', ['<first.x>', '<second.y>']],
    ['<broken\n{{ENV}}<= <after.y>', ['{{ENV}}', '<after.y>']],
  ])('preserves environment overlap precedence and reference offsets in %s', (source, expected) => {
    const tokens = findWorkflowReferenceTokens(source)
    expect(tokens.map((token) => token.value)).toEqual(expected)
    for (const token of tokens) expect(source.slice(token.start, token.end)).toBe(token.value)
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
})
