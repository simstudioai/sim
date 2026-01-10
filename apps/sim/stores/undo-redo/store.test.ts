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
  createAddEdgeEntry,
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
    it('should add an operation to the undo stack', () => {
      const { push, getStackSizes } = useUndoRedoStore.getState()
      const entry = createAddBlockEntry('block-1', { workflowId, userId })

      push(workflowId, userId, entry)

      expect(getStackSizes(workflowId, userId)).toEqual({
        undoSize: 1,
        redoSize: 0,
      })
    })

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

    it('should limit number of stacks to 5', () => {
      const { push } = useUndoRedoStore.getState()

      // Create 6 different workflow/user combinations
      for (let i = 0; i < 6; i++) {
        const wfId = `wf-${i}`
        const uId = `user-${i}`
        push(wfId, uId, createAddBlockEntry(`block-${i}`, { workflowId: wfId, userId: uId }))
      }

      const { stacks } = useUndoRedoStore.getState()
      expect(Object.keys(stacks).length).toBe(5)
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

  describe('undo', () => {
    it('should return the last operation and move it to redo', () => {
      const { push, undo, getStackSizes } = useUndoRedoStore.getState()
      const entry = createAddBlockEntry('block-1', { workflowId, userId })

      push(workflowId, userId, entry)
      const result = undo(workflowId, userId)

      expect(result).toEqual(entry)
      expect(getStackSizes(workflowId, userId)).toEqual({
        undoSize: 0,
        redoSize: 1,
      })
    })

    it('should return null when undo stack is empty', () => {
      const { undo } = useUndoRedoStore.getState()

      const result = undo(workflowId, userId)

      expect(result).toBeNull()
    })

    it('should undo operations in LIFO order', () => {
      const { push, undo } = useUndoRedoStore.getState()

      const entry1 = createAddBlockEntry('block-1', { workflowId, userId })
      const entry2 = createAddBlockEntry('block-2', { workflowId, userId })
      const entry3 = createAddBlockEntry('block-3', { workflowId, userId })

      push(workflowId, userId, entry1)
      push(workflowId, userId, entry2)
      push(workflowId, userId, entry3)

      expect(undo(workflowId, userId)).toEqual(entry3)
      expect(undo(workflowId, userId)).toEqual(entry2)
      expect(undo(workflowId, userId)).toEqual(entry1)
    })
  })

  describe('redo', () => {
    it('should return the last undone operation and move it back to undo', () => {
      const { push, undo, redo, getStackSizes } = useUndoRedoStore.getState()
      const entry = createAddBlockEntry('block-1', { workflowId, userId })

      push(workflowId, userId, entry)
      undo(workflowId, userId)
      const result = redo(workflowId, userId)

      expect(result).toEqual(entry)
      expect(getStackSizes(workflowId, userId)).toEqual({
        undoSize: 1,
        redoSize: 0,
      })
    })

    it('should return null when redo stack is empty', () => {
      const { redo } = useUndoRedoStore.getState()

      const result = redo(workflowId, userId)

      expect(result).toBeNull()
    })

    it('should redo operations in LIFO order', () => {
      const { push, undo, redo } = useUndoRedoStore.getState()

      const entry1 = createAddBlockEntry('block-1', { workflowId, userId })
      const entry2 = createAddBlockEntry('block-2', { workflowId, userId })

      push(workflowId, userId, entry1)
      push(workflowId, userId, entry2)
      undo(workflowId, userId)
      undo(workflowId, userId)

      expect(redo(workflowId, userId)).toEqual(entry1)
      expect(redo(workflowId, userId)).toEqual(entry2)
    })
  })

  describe('clear', () => {
    it('should clear both undo and redo stacks', () => {
      const { push, undo, clear, getStackSizes } = useUndoRedoStore.getState()

      push(workflowId, userId, createAddBlockEntry('block-1', { workflowId, userId }))
      push(workflowId, userId, createAddBlockEntry('block-2', { workflowId, userId }))
      undo(workflowId, userId)

      clear(workflowId, userId)

      expect(getStackSizes(workflowId, userId)).toEqual({
        undoSize: 0,
        redoSize: 0,
      })
    })

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

  describe('clearRedo', () => {
    it('should only clear the redo stack', () => {
      const { push, undo, clearRedo, getStackSizes } = useUndoRedoStore.getState()

      push(workflowId, userId, createAddBlockEntry('block-1', { workflowId, userId }))
      push(workflowId, userId, createAddBlockEntry('block-2', { workflowId, userId }))
      undo(workflowId, userId)

      clearRedo(workflowId, userId)

      expect(getStackSizes(workflowId, userId)).toEqual({
        undoSize: 1,
        redoSize: 0,
      })
    })
  })

  describe('getStackSizes', () => {
    it('should return zero sizes for non-existent stack', () => {
      const { getStackSizes } = useUndoRedoStore.getState()

      expect(getStackSizes('non-existent', 'user')).toEqual({
        undoSize: 0,
        redoSize: 0,
      })
    })

    it('should return correct sizes', () => {
      const { push, undo, getStackSizes } = useUndoRedoStore.getState()

      push(workflowId, userId, createAddBlockEntry('block-1', { workflowId, userId }))
      push(workflowId, userId, createAddBlockEntry('block-2', { workflowId, userId }))
      push(workflowId, userId, createAddBlockEntry('block-3', { workflowId, userId }))
      undo(workflowId, userId)

      expect(getStackSizes(workflowId, userId)).toEqual({
        undoSize: 2,
        redoSize: 1,
      })
    })
  })

  describe('setCapacity', () => {
    it('should update capacity', () => {
      const { setCapacity } = useUndoRedoStore.getState()

      setCapacity(50)

      expect(useUndoRedoStore.getState().capacity).toBe(50)
    })

    it('should truncate existing stacks to new capacity', () => {
      const { push, setCapacity, getStackSizes } = useUndoRedoStore.getState()

      for (let i = 0; i < 10; i++) {
        push(workflowId, userId, createAddBlockEntry(`block-${i}`, { workflowId, userId }))
      }

      expect(getStackSizes(workflowId, userId).undoSize).toBe(10)

      setCapacity(5)

      expect(getStackSizes(workflowId, userId).undoSize).toBe(5)
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
    it('should skip operations when recording is suspended', async () => {
      const { push, getStackSizes } = useUndoRedoStore.getState()

      await runWithUndoRedoRecordingSuspended(() => {
        push(workflowId, userId, createAddBlockEntry('block-1', { workflowId, userId }))
      })

      expect(getStackSizes(workflowId, userId).undoSize).toBe(0)
    })

    it('should resume recording after suspension ends', async () => {
      const { push, getStackSizes } = useUndoRedoStore.getState()

      await runWithUndoRedoRecordingSuspended(() => {
        push(workflowId, userId, createAddBlockEntry('block-1', { workflowId, userId }))
      })

      push(workflowId, userId, createAddBlockEntry('block-2', { workflowId, userId }))

      expect(getStackSizes(workflowId, userId).undoSize).toBe(1)
    })

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

    it('should not affect other stacks when undoing', () => {
      const { push, undo, getStackSizes } = useUndoRedoStore.getState()

      push(
        'wf-1',
        'user-1',
        createAddBlockEntry('block-1', { workflowId: 'wf-1', userId: 'user-1' })
      )
      push(
        'wf-2',
        'user-1',
        createAddBlockEntry('block-2', { workflowId: 'wf-2', userId: 'user-1' })
      )

      undo('wf-1', 'user-1')

      expect(getStackSizes('wf-1', 'user-1').undoSize).toBe(0)
      expect(getStackSizes('wf-2', 'user-1').undoSize).toBe(1)
    })
  })

  describe('edge cases', () => {
    it('should handle rapid consecutive operations', () => {
      const { push, getStackSizes } = useUndoRedoStore.getState()

      for (let i = 0; i < 50; i++) {
        push(workflowId, userId, createAddBlockEntry(`block-${i}`, { workflowId, userId }))
      }

      expect(getStackSizes(workflowId, userId).undoSize).toBe(50)
    })

    it('should handle multiple undo/redo cycles', () => {
      const { push, undo, redo, getStackSizes } = useUndoRedoStore.getState()

      push(workflowId, userId, createAddBlockEntry('block-1', { workflowId, userId }))

      for (let i = 0; i < 10; i++) {
        undo(workflowId, userId)
        redo(workflowId, userId)
      }

      expect(getStackSizes(workflowId, userId)).toEqual({
        undoSize: 1,
        redoSize: 0,
      })
    })

    it('should handle mixed operation types', () => {
      const { push, undo, getStackSizes } = useUndoRedoStore.getState()

      push(workflowId, userId, createAddBlockEntry('block-1', { workflowId, userId }))
      push(workflowId, userId, createAddEdgeEntry('edge-1', { workflowId, userId }))
      push(
        workflowId,
        userId,
        createMoveBlockEntry('block-1', {
          workflowId,
          userId,
          before: { x: 0, y: 0 },
          after: { x: 100, y: 100 },
        })
      )
      push(workflowId, userId, createRemoveBlockEntry('block-2', null, { workflowId, userId }))

      expect(getStackSizes(workflowId, userId).undoSize).toBe(4)

      undo(workflowId, userId)
      undo(workflowId, userId)

      expect(getStackSizes(workflowId, userId)).toEqual({
        undoSize: 2,
        redoSize: 2,
      })
    })
  })

  describe('edge operations', () => {
    it('should handle add-edge operations', () => {
      const { push, undo, redo, getStackSizes } = useUndoRedoStore.getState()

      push(workflowId, userId, createAddEdgeEntry('edge-1', { workflowId, userId }))
      push(workflowId, userId, createAddEdgeEntry('edge-2', { workflowId, userId }))

      expect(getStackSizes(workflowId, userId).undoSize).toBe(2)

      const entry = undo(workflowId, userId)
      expect(entry?.operation.type).toBe('batch-add-edges')
      expect(getStackSizes(workflowId, userId).redoSize).toBe(1)

      redo(workflowId, userId)
      expect(getStackSizes(workflowId, userId).undoSize).toBe(2)
    })

    it('should handle batch-remove-edges operations', () => {
      const { push, undo, getStackSizes } = useUndoRedoStore.getState()

      const edgeSnapshot = { id: 'edge-1', source: 'block-1', target: 'block-2' }
      push(workflowId, userId, createBatchRemoveEdgesEntry([edgeSnapshot], { workflowId, userId }))

      expect(getStackSizes(workflowId, userId).undoSize).toBe(1)

      const entry = undo(workflowId, userId)
      expect(entry?.operation.type).toBe('batch-remove-edges')
      expect(entry?.inverse.type).toBe('batch-add-edges')
    })
  })

  describe('update-parent operations', () => {
    it('should handle update-parent operations', () => {
      const { push, undo, redo, getStackSizes } = useUndoRedoStore.getState()

      push(
        workflowId,
        userId,
        createUpdateParentEntry('block-1', {
          workflowId,
          userId,
          oldParentId: undefined,
          newParentId: 'loop-1',
          oldPosition: { x: 100, y: 100 },
          newPosition: { x: 50, y: 50 },
        })
      )

      expect(getStackSizes(workflowId, userId).undoSize).toBe(1)

      const entry = undo(workflowId, userId)
      expect(entry?.operation.type).toBe('update-parent')
      expect(entry?.inverse.type).toBe('update-parent')

      redo(workflowId, userId)
      expect(getStackSizes(workflowId, userId).undoSize).toBe(1)
    })

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

  describe('complex scenarios', () => {
    it('should handle a complete workflow creation scenario', () => {
      const { push, undo, redo, getStackSizes } = useUndoRedoStore.getState()

      push(workflowId, userId, createAddBlockEntry('starter', { workflowId, userId }))
      push(workflowId, userId, createAddBlockEntry('agent-1', { workflowId, userId }))
      push(workflowId, userId, createAddEdgeEntry('edge-1', { workflowId, userId }))
      push(
        workflowId,
        userId,
        createMoveBlockEntry('agent-1', {
          workflowId,
          userId,
          before: { x: 0, y: 0 },
          after: { x: 200, y: 100 },
        })
      )

      expect(getStackSizes(workflowId, userId).undoSize).toBe(4)

      undo(workflowId, userId)
      undo(workflowId, userId)
      expect(getStackSizes(workflowId, userId)).toEqual({ undoSize: 2, redoSize: 2 })

      redo(workflowId, userId)
      expect(getStackSizes(workflowId, userId)).toEqual({ undoSize: 3, redoSize: 1 })

      push(workflowId, userId, createAddBlockEntry('agent-2', { workflowId, userId }))
      expect(getStackSizes(workflowId, userId)).toEqual({ undoSize: 4, redoSize: 0 })
    })

    it('should handle loop workflow with child blocks', () => {
      const { push, undo, getStackSizes } = useUndoRedoStore.getState()

      push(workflowId, userId, createAddBlockEntry('loop-1', { workflowId, userId }))

      push(
        workflowId,
        userId,
        createUpdateParentEntry('child-1', {
          workflowId,
          userId,
          oldParentId: undefined,
          newParentId: 'loop-1',
        })
      )

      push(
        workflowId,
        userId,
        createMoveBlockEntry('child-1', {
          workflowId,
          userId,
          before: { x: 0, y: 0 },
          after: { x: 50, y: 50 },
        })
      )

      expect(getStackSizes(workflowId, userId).undoSize).toBe(3)

      const moveEntry = undo(workflowId, userId)
      expect(moveEntry?.operation.type).toBe('batch-move-blocks')

      const parentEntry = undo(workflowId, userId)
      expect(parentEntry?.operation.type).toBe('update-parent')
    })
  })
})
