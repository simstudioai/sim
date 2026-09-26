import { describe, expect, it } from 'vitest'
import type { ActiveSearchTarget } from '@/stores/panel/editor/store'
import { getWorkflowSearchLabelHighlight } from './workflow-search-highlight'

const baseTarget: ActiveSearchTarget = {
  matchId: 'match-1',
  blockId: 'block-1',
  subBlockId: 'field',
  canonicalSubBlockId: 'field',
  valuePath: [],
  kind: 'text',
  targetKind: 'subblock',
  subBlockType: 'short-input',
  rawValue: 'beta',
  searchText: 'beta',
  query: 'beta',
  range: { start: 6, end: 10 },
}

describe('workflow search highlight helpers', () => {
  it('does not highlight a whole resource label when the active query is not visible in it', () => {
    const resourceTarget = {
      ...baseTarget,
      kind: 'file',
      rawValue: 'presentation-id',
      searchText: 'presentation-id',
      query: 'test',
      range: undefined,
    }

    expect(
      getWorkflowSearchLabelHighlight({
        activeSearchTarget: resourceTarget,
        blockId: 'block-1',
        subBlockId: 'field',
        valuePath: [],
        label: 'Gucci Case',
      })
    ).toBeNull()
  })

  it('maps fallback ranges back to original string boundaries when lowercasing expands characters', () => {
    const resourceTarget = {
      ...baseTarget,
      kind: 'workflow',
      rawValue: 'workflow-1',
      searchText: 'workflow-1',
      query: 'foo',
      range: undefined,
    }

    expect(
      getWorkflowSearchLabelHighlight({
        activeSearchTarget: resourceTarget,
        blockId: 'block-1',
        subBlockId: 'field',
        valuePath: [],
        label: 'İFoo',
      })
    ).toEqual({ range: { start: 1, end: 4 }, rawValue: 'Foo' })
  })

  it('highlights the original character when a query matches part of an expanded lowercase form', () => {
    const resourceTarget = {
      ...baseTarget,
      kind: 'workflow',
      rawValue: 'workflow-1',
      searchText: 'workflow-1',
      query: 'i',
      range: undefined,
    }

    expect(
      getWorkflowSearchLabelHighlight({
        activeSearchTarget: resourceTarget,
        blockId: 'block-1',
        subBlockId: 'field',
        valuePath: [],
        label: 'İstanbul',
      })
    ).toEqual({ range: { start: 0, end: 1 }, rawValue: 'İ' })
  })
})
