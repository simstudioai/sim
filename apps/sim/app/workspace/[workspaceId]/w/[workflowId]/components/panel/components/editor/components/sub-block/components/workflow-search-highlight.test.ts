import { describe, expect, it } from 'vitest'
import type { ActiveSearchTarget } from '@/stores/panel/editor/store'
import {
  getActiveWorkflowSearchHighlight,
  getWorkflowSearchLabelHighlight,
  isWorkflowSearchTargetForField,
  workflowSearchPathsEqual,
} from './workflow-search-highlight'

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
  it('matches exact value paths', () => {
    expect(workflowSearchPathsEqual([0, 'params', 'body'], [0, 'params', 'body'])).toBe(true)
    expect(workflowSearchPathsEqual([0, 'params', 'body'], [0, 'params'])).toBe(false)
  })

  it('returns an exact active range only for the matching field', () => {
    expect(
      getActiveWorkflowSearchHighlight({
        activeSearchTarget: baseTarget,
        blockId: 'block-1',
        subBlockId: 'field',
        valuePath: [],
      })
    ).toEqual({ range: { start: 6, end: 10 }, rawValue: 'beta' })

    expect(
      getActiveWorkflowSearchHighlight({
        activeSearchTarget: baseTarget,
        blockId: 'block-1',
        subBlockId: 'other',
        valuePath: [],
      })
    ).toBeNull()

    expect(
      getActiveWorkflowSearchHighlight({
        activeSearchTarget: baseTarget,
        blockId: 'block-2',
        subBlockId: 'field',
        valuePath: [],
      })
    ).toBeNull()
  })

  it('supports nested paths for structured fields', () => {
    const nestedTarget = {
      ...baseTarget,
      subBlockId: 'table',
      canonicalSubBlockId: 'table',
      valuePath: [1, 'cells', 'email'],
    }

    expect(
      isWorkflowSearchTargetForField({
        activeSearchTarget: nestedTarget,
        blockId: 'block-1',
        subBlockId: 'table',
        valuePath: [1, 'cells', 'email'],
      })
    ).toBe(true)
  })

  it('falls back to visible label substrings for resources without exact ranges', () => {
    const resourceTarget = {
      ...baseTarget,
      kind: 'knowledge-base',
      rawValue: 'kb-1',
      searchText: 'kb-1',
      query: 'sales',
      range: undefined,
    }

    expect(
      getWorkflowSearchLabelHighlight({
        activeSearchTarget: resourceTarget,
        blockId: 'block-1',
        subBlockId: 'field',
        valuePath: [],
        label: 'Quarterly Sales Knowledge',
      })
    ).toEqual({ range: { start: 10, end: 15 }, rawValue: 'Sales' })
  })

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

  it('uses trimmed query length for resource label fallback ranges', () => {
    const resourceTarget = {
      ...baseTarget,
      kind: 'workflow',
      rawValue: 'workflow-1',
      searchText: 'workflow-1',
      query: ' test ',
      range: undefined,
    }

    expect(
      getWorkflowSearchLabelHighlight({
        activeSearchTarget: resourceTarget,
        blockId: 'block-1',
        subBlockId: 'field',
        valuePath: [],
        label: 'My Test Workflow',
      })
    ).toEqual({ range: { start: 3, end: 7 }, rawValue: 'Test' })
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

  it('falls back to the visible query when a display-label range no longer matches the label', () => {
    const truncatedLabelTarget = {
      ...baseTarget,
      kind: 'file',
      rawValue: 'presentation-final.pdf',
      searchText: 'presentation-final.pdf',
      query: 'final',
      range: { start: 13, end: 18 },
    }

    expect(
      getWorkflowSearchLabelHighlight({
        activeSearchTarget: truncatedLabelTarget,
        blockId: 'block-1',
        subBlockId: 'field',
        valuePath: [],
        label: 'presentation...final.pdf',
      })
    ).toEqual({ range: { start: 15, end: 20 }, rawValue: 'final' })
  })
})
