/**
 * Tests for undo/redo reveal targeting — deciding which block (if any) an applied
 * operation should bring into view so a reverted change is never left off-screen.
 */

import { describe, expect, it } from 'vitest'
import { getRevealTarget } from '@/stores/undo-redo/reveal'
import type { BatchUpdateSubblocksOperation, Operation } from '@/stores/undo-redo/types'

function baseFields() {
  return {
    id: 'op-1',
    timestamp: 0,
    workflowId: 'wf-1',
    userId: 'user-1',
  }
}

function subblockOp(data: BatchUpdateSubblocksOperation['data']): BatchUpdateSubblocksOperation {
  return { ...baseFields(), type: 'batch-update-subblocks', data }
}

describe('getRevealTarget', () => {
  it('reveals the block for a subblock field edit', () => {
    const op = subblockOp({
      updates: [{ blockId: 'block-1', subBlockId: 'systemPrompt', before: '', after: 'hi' }],
    })

    expect(getRevealTarget(op)).toEqual({ blockId: 'block-1' })
  })

  it('reveals the block for a subflow (loop/parallel) config edit', () => {
    const op = subblockOp({
      updates: [],
      subflowUpdates: [
        {
          blockId: 'loop-1',
          blockType: 'loop',
          fieldId: 'subflowIterations',
          before: 5,
          after: 10,
        },
      ],
    })

    expect(getRevealTarget(op)).toEqual({ blockId: 'loop-1' })
  })

  it('prefers the first subblock update when both are present', () => {
    const op = subblockOp({
      updates: [{ blockId: 'block-a', subBlockId: 'model', before: 'x', after: 'y' }],
      subflowUpdates: [
        {
          blockId: 'loop-b',
          blockType: 'parallel',
          fieldId: 'subflowBatchSize',
          before: 1,
          after: 2,
        },
      ],
    })

    expect(getRevealTarget(op)).toEqual({ blockId: 'block-a' })
  })

  it('returns null when there is nothing to reveal', () => {
    expect(getRevealTarget(subblockOp({ updates: [] }))).toBeNull()
  })

  it.each([
    'batch-add-blocks',
    'batch-remove-blocks',
    'batch-add-edges',
    'batch-remove-edges',
    'batch-move-blocks',
    'update-parent',
  ])('returns null for structural operation %s (already visible on canvas)', (type) => {
    const op = { ...baseFields(), type, data: {} } as unknown as Operation

    expect(getRevealTarget(op)).toBeNull()
  })
})
