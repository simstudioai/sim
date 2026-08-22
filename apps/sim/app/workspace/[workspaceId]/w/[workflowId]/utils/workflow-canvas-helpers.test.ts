/**
 * @vitest-environment node
 */
import { describe, expect, it } from 'vitest'
import {
  getArrowNavigationDirection,
  isPositionalTriggerBlock,
  reconcileCanvasEdges,
  reconcileCanvasNodes,
  shouldHighlightContainerDropTarget,
} from '@/app/workspace/[workspaceId]/w/[workflowId]/utils/workflow-canvas-helpers'

describe('getArrowNavigationDirection', () => {
  it('moves once for a fresh horizontal arrow press', () => {
    expect(
      getArrowNavigationDirection({
        key: 'ArrowRight',
        repeat: false,
        metaKey: false,
        ctrlKey: false,
        altKey: false,
        shiftKey: false,
      })
    ).toBe(1)
    expect(
      getArrowNavigationDirection({
        key: 'ArrowLeft',
        repeat: false,
        metaKey: false,
        ctrlKey: false,
        altKey: false,
        shiftKey: false,
      })
    ).toBe(-1)
  })

  it('ignores held-arrow repeat events instead of restarting canvas navigation', () => {
    expect(
      getArrowNavigationDirection({
        key: 'ArrowRight',
        repeat: true,
        metaKey: false,
        ctrlKey: false,
        altKey: false,
        shiftKey: false,
      })
    ).toBeNull()
  })

  it('ignores modified arrows and unrelated keys', () => {
    expect(
      getArrowNavigationDirection({
        key: 'ArrowDown',
        repeat: false,
        metaKey: false,
        ctrlKey: false,
        altKey: false,
        shiftKey: true,
      })
    ).toBeNull()
    expect(
      getArrowNavigationDirection({
        key: 'Enter',
        repeat: false,
        metaKey: false,
        ctrlKey: false,
        altKey: false,
        shiftKey: false,
      })
    ).toBeNull()
  })
})

describe('canvas reference reconciliation', () => {
  it('preserves unaffected node references when one block measurement changes', () => {
    const currentNodes = [
      {
        id: 'block-1',
        position: { x: 0, y: 0 },
        data: { name: 'One' },
        height: 100,
        selected: true,
      },
      {
        id: 'block-2',
        position: { x: 200, y: 0 },
        data: { name: 'Two' },
        height: 100,
        selected: false,
      },
    ]
    const derivedNodes = [
      {
        id: 'block-1',
        position: { x: 0, y: 0 },
        data: { name: 'One' },
        height: 120,
      },
      {
        id: 'block-2',
        position: { x: 200, y: 0 },
        data: { name: 'Two' },
        height: 100,
      },
    ]

    const reconciled = reconcileCanvasNodes(currentNodes, derivedNodes)

    expect(reconciled).not.toBe(currentNodes)
    expect(reconciled[0]).not.toBe(currentNodes[0])
    expect(reconciled[0].selected).toBe(true)
    expect(reconciled[1]).toBe(currentNodes[1])
  })

  it('preserves edge references when a graph refresh changes no edge semantics', () => {
    const onDelete = () => {}
    const currentEdges = [
      {
        id: 'edge-1',
        source: 'block-1',
        target: 'block-2',
        data: { onDelete, isSelected: false },
      },
    ]
    const derivedEdges = [
      {
        id: 'edge-1',
        source: 'block-1',
        target: 'block-2',
        data: { onDelete, isSelected: false },
      },
    ]

    const reconciled = reconcileCanvasEdges(currentEdges, derivedEdges)

    expect(reconciled).toBe(currentEdges)
    expect(reconciled[0]).toBe(currentEdges[0])
  })

  it('applies derived graph order while retaining unchanged item references', () => {
    const currentNodes = [
      { id: 'block-1', position: { x: 0, y: 0 }, data: {}, selected: false },
      { id: 'block-2', position: { x: 100, y: 0 }, data: {}, selected: false },
    ]
    const currentEdges = [
      { id: 'edge-1', source: 'block-1', target: 'block-2' },
      { id: 'edge-2', source: 'block-2', target: 'block-1' },
    ]

    const reconciledNodes = reconcileCanvasNodes(currentNodes, [
      { id: 'block-2', position: { x: 100, y: 0 }, data: {} },
      { id: 'block-1', position: { x: 0, y: 0 }, data: {} },
    ])
    const reconciledEdges = reconcileCanvasEdges(currentEdges, [
      { ...currentEdges[1] },
      { ...currentEdges[0] },
    ])

    expect(reconciledNodes).toEqual([currentNodes[1], currentNodes[0]])
    expect(reconciledEdges).toEqual([currentEdges[1], currentEdges[0]])
    expect(reconciledNodes[0]).toBe(currentNodes[1])
    expect(reconciledEdges[0]).toBe(currentEdges[1])
  })
})

describe('isPositionalTriggerBlock', () => {
  it('returns true for a top-level block with no incoming edges', () => {
    const block = { id: 'block-1' }
    const edges = [{ target: 'other-block' }]

    expect(isPositionalTriggerBlock(block, edges)).toBe(true)
  })

  it('returns true for a top-level block when there are no edges at all', () => {
    expect(isPositionalTriggerBlock({ id: 'block-1' }, [])).toBe(true)
  })

  it('returns false for a top-level block with incoming edges', () => {
    const block = { id: 'block-1' }
    const edges = [{ target: 'block-1' }]

    expect(isPositionalTriggerBlock(block, edges)).toBe(false)
  })

  it('returns false for a block nested in a subflow even with no incoming edges', () => {
    const block = { id: 'nested-block', parentId: 'loop-1' }

    expect(isPositionalTriggerBlock(block, [])).toBe(false)
  })

  it('returns false for a nested block with incoming edges', () => {
    const block = { id: 'nested-block', parentId: 'loop-1' }
    const edges = [{ target: 'nested-block' }]

    expect(isPositionalTriggerBlock(block, edges)).toBe(false)
  })

  it('returns false when no block is provided', () => {
    expect(isPositionalTriggerBlock(undefined, [])).toBe(false)
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

describe('shouldHighlightContainerDropTarget', () => {
  it('does not highlight the loop while a nested block moves within it', () => {
    expect(shouldHighlightContainerDropTarget('loop-1', 'loop-1')).toBe(false)
  })

  it('highlights a different container as a genuine re-parent target', () => {
    expect(shouldHighlightContainerDropTarget('loop-1', 'loop-2')).toBe(true)
    expect(shouldHighlightContainerDropTarget(null, 'loop-1')).toBe(true)
  })
})
