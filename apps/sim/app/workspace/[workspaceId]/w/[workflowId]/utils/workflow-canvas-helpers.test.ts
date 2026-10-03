import { describe, expect, it } from 'vitest'
import {
  applyEdgeSelectionChanges,
  getEdgeSelectionMapKey,
  isPositionalTriggerBlock,
} from '@/app/workspace/[workspaceId]/w/[workflowId]/utils/workflow-canvas-helpers'

describe('edge selection helpers', () => {
  it('keeps modifier selections and removes deselected edges', () => {
    const selected = new Map([['edge-1-loop-1', 'edge-1']])
    const selectionKeys = new Map([
      ['edge-1', 'edge-1-loop-1'],
      ['edge-2', 'edge-2-loop-1'],
    ])

    const withSecondEdge = applyEdgeSelectionChanges(
      selected,
      [{ id: 'edge-2', type: 'select', selected: true }],
      (edgeId) => selectionKeys.get(edgeId) ?? null
    )
    expect([...withSecondEdge]).toEqual([
      ['edge-1-loop-1', 'edge-1'],
      ['edge-2-loop-1', 'edge-2'],
    ])

    const withoutFirstEdge = applyEdgeSelectionChanges(
      withSecondEdge,
      [{ id: 'edge-1', type: 'select', selected: false }],
      (edgeId) => selectionKeys.get(edgeId) ?? null
    )
    expect([...withoutFirstEdge]).toEqual([['edge-2-loop-1', 'edge-2']])
  })

  it('uses nested context keys and ignores temporary edges', () => {
    const key = getEdgeSelectionMapKey(
      { id: 'edge-1', source: 'source', target: 'target' },
      [{ id: 'source', parentId: 'loop-1' }, { id: 'target' }],
      {}
    )
    expect(key).toBe('edge-1-loop-1')

    const selected = new Map<string, string>()
    expect(
      applyEdgeSelectionChanges(
        selected,
        [{ id: 'connection-block-selector-edge', type: 'select', selected: true }],
        () => null
      )
    ).toBe(selected)
  })
})

describe('isPositionalTriggerBlock', () => {
  it('returns false for a block nested in a subflow even with no incoming edges', () => {
    const block = { id: 'nested-block', parentId: 'loop-1' }

    expect(isPositionalTriggerBlock(block, [])).toBe(false)
  })

  /**
   * Regression: a block copy-pasted into a loop is bound to the subflow
   * (parentId set) but has no edges yet. It must not be classified as a
   * positional trigger — that classification hid "Remove from Subflow"
   * in the block context menu.
   */
  it('does not classify a freshly pasted, unconnected block inside a loop as a trigger', () => {
    const pastedBlock = { id: 'pasted-cloudwatch', parentId: 'loop-iterate-workflows' }
    const edges = [
      { target: 'parse-ids' },
      { target: 'loop-iterate-workflows' },
      { target: 'run-subworkflow' },
      { target: 'check-result' },
      { target: 'publish-success' },
      { target: 'publish-failure' },
    ]

    expect(isPositionalTriggerBlock(pastedBlock, edges)).toBe(false)
  })
})
