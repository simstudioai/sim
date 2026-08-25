import {
  findWorkflowReferenceTokens,
  isLikelyWorkflowReferenceSegment,
  splitWorkflowReferenceSegment,
} from '@sim/utils/workflow-references'
import { describe, expect, it } from 'vitest'

describe('workflow references', () => {
  it('separates comparison prefixes from the final reference', () => {
    expect(splitWorkflowReferenceSegment('<= <block.output>')).toEqual({
      leading: '<= ',
      reference: '<block.output>',
    })
  })

  it('distinguishes references from comparisons and numeric angle brackets', () => {
    expect(isLikelyWorkflowReferenceSegment('<block.output>')).toBe(true)
    expect(isLikelyWorkflowReferenceSegment('<parameter>')).toBe(true)
    expect(isLikelyWorkflowReferenceSegment('< limit && total >')).toBe(false)
    expect(isLikelyWorkflowReferenceSegment('<123>')).toBe(false)
  })

  it('finds environment and workflow tokens without treating comparisons as references', () => {
    const source = [
      'const secret = {{SECRET_NAME_REF}}',
      'const result = <blockOutput.field>',
      'const comparison = count < limit && total > 0',
    ].join('\n')

    expect(findWorkflowReferenceTokens(source).map(({ kind, value }) => ({ kind, value }))).toEqual(
      [
        { kind: 'environment', value: '{{SECRET_NAME_REF}}' },
        { kind: 'workflow', value: '<blockOutput.field>' },
      ]
    )
  })

  it('rejects compact boolean and nested comparison expressions', () => {
    expect(findWorkflowReferenceTokens('value <limit && value>max')).toEqual([])
    expect(findWorkflowReferenceTokens('value<limit||value>max')).toEqual([])
    expect(findWorkflowReferenceTokens('a<b<c>d')).toEqual([])
  })

  it('retains a reference after a comparison prefix', () => {
    expect(findWorkflowReferenceTokens('value < <block.output>')).toEqual([
      {
        kind: 'workflow',
        value: '<block.output>',
        start: 8,
        end: 22,
      },
    ])
  })
})
