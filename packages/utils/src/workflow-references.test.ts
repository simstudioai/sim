import {
  findWorkflowReferenceTokens,
  isLikelyWorkflowReferenceSegment,
  splitOutsideWorkflowReferences,
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

  it('suppresses a workflow reference that overlaps an environment placeholder', () => {
    expect(
      findWorkflowReferenceTokens('<a.{{B}}> <c.d>').map(({ kind, value }) => ({ kind, value }))
    ).toEqual([
      { kind: 'environment', value: '{{B}}' },
      { kind: 'workflow', value: '<c.d>' },
    ])
  })

  it('stays linear on a reference-dense value', () => {
    const startedAt = performance.now()
    const tokens = findWorkflowReferenceTokens('<a.b>{{C}}'.repeat(80_000))
    expect(tokens).toHaveLength(160_000)
    expect(performance.now() - startedAt).toBeLessThan(1000)
  })
})

describe('splitOutsideWorkflowReferences', () => {
  it('splits on commas, trims entries, and drops empty ones', () => {
    expect(splitOutsideWorkflowReferences(' kb_a , , kb_b ,')).toEqual(['kb_a', 'kb_b'])
    expect(splitOutsideWorkflowReferences('kb_a')).toEqual(['kb_a'])
    expect(splitOutsideWorkflowReferences(' , ')).toEqual([])
  })

  it('keeps a comma inside a workflow reference or environment placeholder', () => {
    expect(splitOutsideWorkflowReferences('kb_a,<start.pick(x,y)>,kb_b')).toEqual([
      'kb_a',
      '<start.pick(x,y)>',
      'kb_b',
    ])
    expect(splitOutsideWorkflowReferences('{{A,B}},kb_a')).toEqual(['{{A,B}}', 'kb_a'])
  })

  it('protects a workflow reference that wraps an environment placeholder', () => {
    expect(splitOutsideWorkflowReferences('<start.body.pick({{A}},b)>,kb_a')).toEqual([
      '<start.body.pick({{A}},b)>',
      'kb_a',
    ])
    expect(splitOutsideWorkflowReferences('<a.{{B}}x,y>,kb_a')).toEqual(['<a.{{B}}x,y>', 'kb_a'])
  })

  it('splits a near-miss that does not read as a reference', () => {
    expect(splitOutsideWorkflowReferences('<a.b+c,d>')).toEqual(['<a.b+c', 'd>'])
    expect(splitOutsideWorkflowReferences('value <limit && a, value>max')).toEqual([
      'value <limit && a',
      'value>max',
    ])
  })

  it('stays linear on a large value', () => {
    const startedAt = performance.now()
    const entries = splitOutsideWorkflowReferences('{{A}},<b.c(d,e)>,'.repeat(40_000))
    expect(entries).toHaveLength(80_000)
    expect(performance.now() - startedAt).toBeLessThan(1000)
  })
})
