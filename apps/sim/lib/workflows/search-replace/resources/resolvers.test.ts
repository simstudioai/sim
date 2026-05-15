/**
 * @vitest-environment node
 */
import { describe, expect, it } from 'vitest'
import { dedupeOverlappingWorkflowSearchMatches } from '@/lib/workflows/search-replace/resources/resolvers'
import type { WorkflowSearchMatch } from '@/lib/workflows/search-replace/types'

function createMatch(overrides: Partial<WorkflowSearchMatch>): WorkflowSearchMatch {
  return {
    id: 'match',
    blockId: 'block-1',
    blockName: 'Block',
    blockType: 'function',
    subBlockId: 'code',
    canonicalSubBlockId: 'code',
    subBlockType: 'code',
    valuePath: [],
    target: { kind: 'subblock' },
    kind: 'text',
    rawValue: '',
    searchText: '',
    editable: true,
    navigable: true,
    protected: false,
    ...overrides,
  }
}

describe('dedupeOverlappingWorkflowSearchMatches', () => {
  it('keeps the narrower text hit when a partial literal query overlaps an inline reference', () => {
    const textMatch = createMatch({
      id: 'text-partial',
      kind: 'text',
      rawValue: '<start.h',
      searchText: "return '<start.hello>'",
      range: { start: 8, end: 16 },
    })
    const referenceMatch = createMatch({
      id: 'workflow-reference',
      kind: 'workflow-reference',
      rawValue: '<start.hello>',
      searchText: 'start.hello',
      range: { start: 8, end: 21 },
      resource: { kind: 'workflow-reference', token: '<start.hello>', key: 'start.hello' },
    })

    expect(dedupeOverlappingWorkflowSearchMatches([textMatch, referenceMatch])).toEqual([textMatch])
  })

  it('keeps the inline reference when it covers the same span as a text hit', () => {
    const textMatch = createMatch({
      id: 'text-full',
      kind: 'text',
      rawValue: '<start.hello>',
      searchText: "return '<start.hello>'",
      range: { start: 8, end: 21 },
    })
    const referenceMatch = createMatch({
      id: 'workflow-reference',
      kind: 'workflow-reference',
      rawValue: '<start.hello>',
      searchText: 'start.hello',
      range: { start: 8, end: 21 },
      resource: { kind: 'workflow-reference', token: '<start.hello>', key: 'start.hello' },
    })

    expect(dedupeOverlappingWorkflowSearchMatches([textMatch, referenceMatch])).toEqual([
      referenceMatch,
    ])
  })

  it('uses kind priority rather than iteration order for equal-span non-text matches', () => {
    const workflowReferenceMatch = createMatch({
      id: 'workflow-reference',
      kind: 'workflow-reference',
      rawValue: '{{API_KEY}}',
      searchText: 'API_KEY',
      range: { start: 0, end: 11 },
      resource: { kind: 'workflow-reference', token: '{{API_KEY}}', key: 'API_KEY' },
    })
    const environmentMatch = createMatch({
      id: 'environment',
      kind: 'environment',
      rawValue: '{{API_KEY}}',
      searchText: 'API_KEY',
      range: { start: 0, end: 11 },
      resource: { kind: 'environment', token: '{{API_KEY}}', key: 'API_KEY' },
    })

    expect(
      dedupeOverlappingWorkflowSearchMatches([workflowReferenceMatch, environmentMatch])
    ).toEqual([workflowReferenceMatch])
    expect(
      dedupeOverlappingWorkflowSearchMatches([environmentMatch, workflowReferenceMatch])
    ).toEqual([workflowReferenceMatch])
  })

  it('does not collapse matches from different fields', () => {
    const firstMatch = createMatch({
      id: 'first',
      range: { start: 0, end: 4 },
      valuePath: ['first'],
    })
    const secondMatch = createMatch({
      id: 'second',
      range: { start: 0, end: 4 },
      valuePath: ['second'],
    })

    expect(dedupeOverlappingWorkflowSearchMatches([firstMatch, secondMatch])).toEqual([
      firstMatch,
      secondMatch,
    ])
  })
})
