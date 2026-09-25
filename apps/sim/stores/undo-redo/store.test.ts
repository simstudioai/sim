/**
 * Tests for the undo/redo store.
 *
 * These tests cover:
 * - Basic push/undo/redo operations
 * - Stack capacity limits
 * - Move operation coalescing
 * - Recording suspension
 * - Stack pruning
 * - Multi-workflow/user isolation
 */

import {
  createAddBlockEntry,
  createBatchRemoveEdgesEntry,
  createBlock,
  createMockStorage,
  createMoveBlockEntry,
  createRemoveBlockEntry,
  createUpdateParentEntry,
} from '@sim/testing'
import { beforeEach, describe, expect, it } from 'vitest'
import { runWithUndoRedoRecordingSuspended, useUndoRedoStore } from '@/stores/undo-redo/store'
import type { UpdateParentOperation } from '@/stores/undo-redo/types'

describe('useUndoRedoStore', () => {
  const workflowId = 'wf-test'
  const userId = 'user-test'

  beforeEach(() => {
    global.localStorage = createMockStorage()

    useUndoRedoStore.setState({
      stacks: {},
      capacity: 100,
    })
  })

  describe('push', () => {
    it('should clear redo stack when pushing new operation', () => {
      const { push, undo, getStackSizes } = useUndoRedoStore.getState()

      push(workflowId, userId, createAddBlockEntry('block-1', { workflowId, userId }))
      push(workflowId, userId, createAddBlockEntry('block-2', { workflowId, userId }))
      undo(workflowId, userId)

      expect(getStackSizes(workflowId, userId).redoSize).toBe(1)

      push(workflowId, userId, createAddBlockEntry('block-3', { workflowId, userId }))

      expect(getStackSizes(workflowId, userId)).toEqual({
        undoSize: 2,
        redoSize: 0,
      })
    })

    it('should respect capacity limit', () => {
      useUndoRedoStore.setState({ capacity: 3 })
      const { push, getStackSizes } = useUndoRedoStore.getState()

      for (let i = 0; i < 5; i++) {
        push(workflowId, userId, createAddBlockEntry(`block-${i}`, { workflowId, userId }))
      }

      expect(getStackSizes(workflowId, userId).undoSize).toBe(3)
    })

    it('should remove oldest stack when limit exceeded', () => {
      const { push } = useUndoRedoStore.getState()

      // Create stacks with varying timestamps
      for (let i = 0; i < 5; i++) {
        push(`wf-${i}`, `user-${i}`, createAddBlockEntry(`block-${i}`))
      }

      // Add a 6th stack - should remove the oldest
      push('wf-new', 'user-new', createAddBlockEntry('block-new'))

      const { stacks } = useUndoRedoStore.getState()
      expect(Object.keys(stacks).length).toBe(5)
      expect(stacks['wf-new:user-new']).toBeDefined()
    })
  })

  describe('clear', () => {
    it('should only clear stacks for specified workflow/user', () => {
      const { push, clear, getStackSizes } = useUndoRedoStore.getState()

      push(
        'wf-1',
        'user-1',
        createAddBlockEntry('block-1', { workflowId: 'wf-1', userId: 'user-1' })
      )
      push(
        'wf-2',
        'user-2',
        createAddBlockEntry('block-2', { workflowId: 'wf-2', userId: 'user-2' })
      )

      clear('wf-1', 'user-1')

      expect(getStackSizes('wf-1', 'user-1').undoSize).toBe(0)
      expect(getStackSizes('wf-2', 'user-2').undoSize).toBe(1)
    })
  })

  describe('move-block coalescing', () => {
    it('should coalesce consecutive moves of the same block', () => {
      const { push, getStackSizes } = useUndoRedoStore.getState()

      push(
        workflowId,
        userId,
        createMoveBlockEntry('block-1', {
          workflowId,
          userId,
          before: { x: 0, y: 0 },
          after: { x: 10, y: 10 },
        })
      )

      push(
        workflowId,
        userId,
        createMoveBlockEntry('block-1', {
          workflowId,
          userId,
          before: { x: 10, y: 10 },
          after: { x: 20, y: 20 },
        })
      )

      // Should coalesce into a single operation
      expect(getStackSizes(workflowId, userId).undoSize).toBe(1)
    })

    it('should not coalesce moves of different blocks', () => {
      const { push, getStackSizes } = useUndoRedoStore.getState()

      push(
        workflowId,
        userId,
        createMoveBlockEntry('block-1', {
          workflowId,
          userId,
          before: { x: 0, y: 0 },
          after: { x: 10, y: 10 },
        })
      )

      push(
        workflowId,
        userId,
        createMoveBlockEntry('block-2', {
          workflowId,
          userId,
          before: { x: 0, y: 0 },
          after: { x: 20, y: 20 },
        })
      )

      expect(getStackSizes(workflowId, userId).undoSize).toBe(2)
    })

    it('should skip no-op moves', () => {
      const { push, getStackSizes } = useUndoRedoStore.getState()

      push(
        workflowId,
        userId,
        createMoveBlockEntry('block-1', {
          workflowId,
          userId,
          before: { x: 100, y: 100 },
          after: { x: 100, y: 100 },
        })
      )

      expect(getStackSizes(workflowId, userId).undoSize).toBe(0)
    })

    it('should preserve original position when coalescing results in no-op', () => {
      const { push, getStackSizes } = useUndoRedoStore.getState()

      // Move block from (0,0) to (10,10)
      push(
        workflowId,
        userId,
        createMoveBlockEntry('block-1', {
          workflowId,
          userId,
          before: { x: 0, y: 0 },
          after: { x: 10, y: 10 },
        })
      )

      // Move block back to (0,0) - coalesces to a no-op
      push(
        workflowId,
        userId,
        createMoveBlockEntry('block-1', {
          workflowId,
          userId,
          before: { x: 10, y: 10 },
          after: { x: 0, y: 0 },
        })
      )

      // Should result in no operations since it's a round-trip
      expect(getStackSizes(workflowId, userId).undoSize).toBe(0)
    })
  })

  describe('recording suspension', () => {
    it('should handle nested suspension correctly', async () => {
      const { push, getStackSizes } = useUndoRedoStore.getState()

      await runWithUndoRedoRecordingSuspended(async () => {
        push(workflowId, userId, createAddBlockEntry('block-1', { workflowId, userId }))

        await runWithUndoRedoRecordingSuspended(() => {
          push(workflowId, userId, createAddBlockEntry('block-2', { workflowId, userId }))
        })

        push(workflowId, userId, createAddBlockEntry('block-3', { workflowId, userId }))
      })

      expect(getStackSizes(workflowId, userId).undoSize).toBe(0)

      push(workflowId, userId, createAddBlockEntry('block-4', { workflowId, userId }))
      expect(getStackSizes(workflowId, userId).undoSize).toBe(1)
    })
  })

  describe('pruneInvalidEntries', () => {
    it('should remove entries for non-existent blocks', () => {
      const { push, pruneInvalidEntries, getStackSizes } = useUndoRedoStore.getState()

      // Add entries for blocks
      push(workflowId, userId, createRemoveBlockEntry('block-1', null, { workflowId, userId }))
      push(workflowId, userId, createRemoveBlockEntry('block-2', null, { workflowId, userId }))

      expect(getStackSizes(workflowId, userId).undoSize).toBe(2)

      // Prune with only block-1 existing
      const graph = {
        blocksById: {
          'block-1': createBlock({ id: 'block-1' }),
        },
        edgesById: {},
      }

      pruneInvalidEntries(workflowId, userId, graph)

      // Only the entry for block-1 should remain (inverse is add-block which requires block NOT exist)
      // Actually, remove-block inverse is add-block, which is applicable when block doesn't exist
      // Let me reconsider: the pruneInvalidEntries checks if the INVERSE is applicable
      // For remove-block, inverse is add-block, which is applicable when block doesn't exist
      expect(getStackSizes(workflowId, userId).undoSize).toBe(1)
    })

    it('should remove redo entries with non-applicable operations', () => {
      const { push, undo, pruneInvalidEntries, getStackSizes } = useUndoRedoStore.getState()

      push(workflowId, userId, createRemoveBlockEntry('block-1', null, { workflowId, userId }))
      undo(workflowId, userId)

      expect(getStackSizes(workflowId, userId).redoSize).toBe(1)

      // Prune - block-1 doesn't exist, so remove-block is not applicable
      pruneInvalidEntries(workflowId, userId, { blocksById: {}, edgesById: {} })

      expect(getStackSizes(workflowId, userId).redoSize).toBe(0)
    })
  })

  describe('workflow/user isolation', () => {
    it('should keep stacks isolated by workflow and user', () => {
      const { push, getStackSizes } = useUndoRedoStore.getState()

      push(
        'wf-1',
        'user-1',
        createAddBlockEntry('block-1', { workflowId: 'wf-1', userId: 'user-1' })
      )
      push(
        'wf-1',
        'user-2',
        createAddBlockEntry('block-2', { workflowId: 'wf-1', userId: 'user-2' })
      )
      push(
        'wf-2',
        'user-1',
        createAddBlockEntry('block-3', { workflowId: 'wf-2', userId: 'user-1' })
      )

      expect(getStackSizes('wf-1', 'user-1').undoSize).toBe(1)
      expect(getStackSizes('wf-1', 'user-2').undoSize).toBe(1)
      expect(getStackSizes('wf-2', 'user-1').undoSize).toBe(1)
    })
  })

  describe('update-parent operations', () => {
    it('should correctly swap parent IDs in inverse operation', () => {
      const { push, undo } = useUndoRedoStore.getState()

      push(
        workflowId,
        userId,
        createUpdateParentEntry('block-1', {
          workflowId,
          userId,
          oldParentId: 'loop-1',
          newParentId: 'loop-2',
          oldPosition: { x: 0, y: 0 },
          newPosition: { x: 100, y: 100 },
        })
      )

      const entry = undo(workflowId, userId)
      const inverse = entry?.inverse as UpdateParentOperation
      expect(inverse.data.oldParentId).toBe('loop-2')
      expect(inverse.data.newParentId).toBe('loop-1')
      expect(inverse.data.oldPosition).toEqual({ x: 100, y: 100 })
      expect(inverse.data.newPosition).toEqual({ x: 0, y: 0 })
    })
  })

  describe('pruneInvalidEntries with edges', () => {
    it('should remove entries for non-existent edges', () => {
      const { push, pruneInvalidEntries, getStackSizes } = useUndoRedoStore.getState()

      const edge1 = { id: 'edge-1', source: 'a', target: 'b' }
      const edge2 = { id: 'edge-2', source: 'c', target: 'd' }
      push(workflowId, userId, createBatchRemoveEdgesEntry([edge1], { workflowId, userId }))
      push(workflowId, userId, createBatchRemoveEdgesEntry([edge2], { workflowId, userId }))

      expect(getStackSizes(workflowId, userId).undoSize).toBe(2)

      const graph = {
        blocksById: {},
        edgesById: {
          'edge-1': { id: 'edge-1', source: 'a', target: 'b' },
        },
      }

      pruneInvalidEntries(workflowId, userId, graph as any)

      // edge-1 exists in graph, so we can't undo its removal (can't add it back) → pruned
      // edge-2 doesn't exist, so we can undo its removal (can add it back) → kept
      expect(getStackSizes(workflowId, userId).undoSize).toBe(1)
    })
  })
})
