/**
 * @vitest-environment node
 */
import { describe, expect, it } from 'vitest'
import { isPositionalTriggerBlock } from '@/app/workspace/[workspaceId]/w/[workflowId]/utils/workflow-canvas-helpers'

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
