/**
 * Tests for the per-workflow execution store.
 *
 * These tests cover:
 * - Default state for unknown workflows
 * - Per-workflow state isolation
 * - Execution lifecycle (start/stop clears run path)
 * - Block and edge run status tracking
 * - Active block management
 * - Debug state management
 * - Execution snapshot management
 * - Store reset
 * - Immutability guarantees
 *
 * @remarks
 * Most tests use `it.concurrent` with unique workflow IDs per test.
 * Because the store isolates state by workflow ID, concurrent tests
 * do not interfere with each other. The `reset` and `immutability`
 * groups run sequentially since they affect or read global store state.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.unmock('@/stores/execution/store')
vi.unmock('@/stores/execution/types')

import { useExecutionStore } from '@/stores/execution/store'
import { defaultWorkflowExecutionState, initialState } from '@/stores/execution/types'

describe('useExecutionStore', () => {
  describe('getWorkflowExecution', () => {
    it.concurrent('should return default state for an unknown workflow', () => {
      const state = useExecutionStore.getState().getWorkflowExecution('wf-get-default')

      expect(state.isExecuting).toBe(false)
      expect(state.isDebugging).toBe(false)
      expect(state.activeBlockIds.size).toBe(0)
      expect(state.pendingBlocks).toEqual([])
      expect(state.executor).toBeNull()
      expect(state.debugContext).toBeNull()
      expect(state.lastRunPath.size).toBe(0)
      expect(state.lastRunEdges.size).toBe(0)
    })

    it.concurrent(
      'should return fresh collections for unknown workflows, not shared references',
      () => {
        const stateA = useExecutionStore.getState().getWorkflowExecution('wf-fresh-a')
        const stateB = useExecutionStore.getState().getWorkflowExecution('wf-fresh-b')

        expect(stateA.activeBlockIds).not.toBe(stateB.activeBlockIds)
        expect(stateA.lastRunPath).not.toBe(stateB.lastRunPath)
        expect(stateA.lastRunEdges).not.toBe(stateB.lastRunEdges)
        expect(stateA.activeBlockIds).not.toBe(defaultWorkflowExecutionState.activeBlockIds)
      }
    )

    it.concurrent('should return the stored state after a mutation', () => {
      useExecutionStore.getState().setIsExecuting('wf-get-stored', true)

      const state = useExecutionStore.getState().getWorkflowExecution('wf-get-stored')
      expect(state.isExecuting).toBe(true)
    })
  })

  describe('setIsExecuting', () => {
    it.concurrent('should set isExecuting to true', () => {
      useExecutionStore.getState().setIsExecuting('wf-exec-true', true)

      expect(useExecutionStore.getState().getWorkflowExecution('wf-exec-true').isExecuting).toBe(
        true
      )
    })

    it.concurrent('should set isExecuting to false', () => {
      useExecutionStore.getState().setIsExecuting('wf-exec-false', true)
      useExecutionStore.getState().setIsExecuting('wf-exec-false', false)

      expect(useExecutionStore.getState().getWorkflowExecution('wf-exec-false').isExecuting).toBe(
        false
      )
    })

    it.concurrent('should clear lastRunPath and lastRunEdges when starting execution', () => {
      const wf = 'wf-exec-clears-run'
      useExecutionStore.getState().setBlockRunStatus(wf, 'block-1', 'success')
      useExecutionStore.getState().setEdgeRunStatus(wf, 'edge-1', 'success')

      expect(useExecutionStore.getState().getWorkflowExecution(wf).lastRunPath.size).toBe(1)
      expect(useExecutionStore.getState().getWorkflowExecution(wf).lastRunEdges.size).toBe(1)

      useExecutionStore.getState().setIsExecuting(wf, true)

      const state = useExecutionStore.getState().getWorkflowExecution(wf)
      expect(state.lastRunPath.size).toBe(0)
      expect(state.lastRunEdges.size).toBe(0)
      expect(state.isExecuting).toBe(true)
    })

    it.concurrent('should NOT clear lastRunPath when stopping execution', () => {
      const wf = 'wf-exec-stop-keeps-path'
      useExecutionStore.getState().setIsExecuting(wf, true)
      useExecutionStore.getState().setBlockRunStatus(wf, 'block-1', 'success')
      useExecutionStore.getState().setIsExecuting(wf, false)

      const state = useExecutionStore.getState().getWorkflowExecution(wf)
      expect(state.isExecuting).toBe(false)
      expect(state.lastRunPath.get('block-1')).toBe('success')
    })
  })

  describe('setActiveBlocks', () => {
    it.concurrent('should set the active block IDs', () => {
      const wf = 'wf-active-set'
      useExecutionStore.getState().setActiveBlocks(wf, new Set(['block-1', 'block-2']))

      const state = useExecutionStore.getState().getWorkflowExecution(wf)
      expect(state.activeBlockIds.has('block-1')).toBe(true)
      expect(state.activeBlockIds.has('block-2')).toBe(true)
      expect(state.activeBlockIds.size).toBe(2)
    })

    it.concurrent('should replace the previous set', () => {
      const wf = 'wf-active-replace'
      useExecutionStore.getState().setActiveBlocks(wf, new Set(['block-1']))
      useExecutionStore.getState().setActiveBlocks(wf, new Set(['block-2']))

      const state = useExecutionStore.getState().getWorkflowExecution(wf)
      expect(state.activeBlockIds.has('block-1')).toBe(false)
      expect(state.activeBlockIds.has('block-2')).toBe(true)
    })

    it.concurrent('should clear active blocks with an empty set', () => {
      const wf = 'wf-active-clear'
      useExecutionStore.getState().setActiveBlocks(wf, new Set(['block-1']))
      useExecutionStore.getState().setActiveBlocks(wf, new Set())

      expect(useExecutionStore.getState().getWorkflowExecution(wf).activeBlockIds.size).toBe(0)
    })
  })

  describe('setPendingBlocks', () => {
    it.concurrent('should set pending block IDs', () => {
      const wf = 'wf-pending'
      useExecutionStore.getState().setPendingBlocks(wf, ['block-1', 'block-2'])

      expect(useExecutionStore.getState().getWorkflowExecution(wf).pendingBlocks).toEqual([
        'block-1',
        'block-2',
      ])
    })
  })

  describe('setIsDebugging', () => {
    it.concurrent('should toggle debug mode', () => {
      const wf = 'wf-debug-toggle'
      useExecutionStore.getState().setIsDebugging(wf, true)

      expect(useExecutionStore.getState().getWorkflowExecution(wf).isDebugging).toBe(true)

      useExecutionStore.getState().setIsDebugging(wf, false)
      expect(useExecutionStore.getState().getWorkflowExecution(wf).isDebugging).toBe(false)
    })
  })

  describe('setExecutor', () => {
    it.concurrent('should store and clear executor', () => {
      const wf = 'wf-executor'
      const mockExecutor = { run: () => {} } as any

      useExecutionStore.getState().setExecutor(wf, mockExecutor)
      expect(useExecutionStore.getState().getWorkflowExecution(wf).executor).toBe(mockExecutor)

      useExecutionStore.getState().setExecutor(wf, null)
      expect(useExecutionStore.getState().getWorkflowExecution(wf).executor).toBeNull()
    })
  })

  describe('setDebugContext', () => {
    it.concurrent('should store and clear debug context', () => {
      const wf = 'wf-debug-ctx'
      const mockContext = { blockId: 'block-1' } as any

      useExecutionStore.getState().setDebugContext(wf, mockContext)
      expect(useExecutionStore.getState().getWorkflowExecution(wf).debugContext).toBe(mockContext)

      useExecutionStore.getState().setDebugContext(wf, null)
      expect(useExecutionStore.getState().getWorkflowExecution(wf).debugContext).toBeNull()
    })
  })

  describe('setBlockRunStatus', () => {
    it.concurrent('should record a success status for a block', () => {
      const wf = 'wf-block-success'
      useExecutionStore.getState().setBlockRunStatus(wf, 'block-1', 'success')

      expect(useExecutionStore.getState().getWorkflowExecution(wf).lastRunPath.get('block-1')).toBe(
        'success'
      )
    })

    it.concurrent('should record an error status for a block', () => {
      const wf = 'wf-block-error'
      useExecutionStore.getState().setBlockRunStatus(wf, 'block-1', 'error')

      expect(useExecutionStore.getState().getWorkflowExecution(wf).lastRunPath.get('block-1')).toBe(
        'error'
      )
    })

    it.concurrent('should accumulate statuses for multiple blocks', () => {
      const wf = 'wf-block-accum'
      useExecutionStore.getState().setBlockRunStatus(wf, 'block-1', 'success')
      useExecutionStore.getState().setBlockRunStatus(wf, 'block-2', 'error')

      const runPath = useExecutionStore.getState().getWorkflowExecution(wf).lastRunPath
      expect(runPath.get('block-1')).toBe('success')
      expect(runPath.get('block-2')).toBe('error')
      expect(runPath.size).toBe(2)
    })

    it.concurrent('should overwrite a previous status for the same block', () => {
      const wf = 'wf-block-overwrite'
      useExecutionStore.getState().setBlockRunStatus(wf, 'block-1', 'error')
      useExecutionStore.getState().setBlockRunStatus(wf, 'block-1', 'success')

      expect(useExecutionStore.getState().getWorkflowExecution(wf).lastRunPath.get('block-1')).toBe(
        'success'
      )
    })
  })

  describe('setEdgeRunStatus', () => {
    it.concurrent('should record a success status for an edge', () => {
      const wf = 'wf-edge-success'
      useExecutionStore.getState().setEdgeRunStatus(wf, 'edge-1', 'success')

      expect(useExecutionStore.getState().getWorkflowExecution(wf).lastRunEdges.get('edge-1')).toBe(
        'success'
      )
    })

    it.concurrent('should accumulate statuses for multiple edges', () => {
      const wf = 'wf-edge-accum'
      useExecutionStore.getState().setEdgeRunStatus(wf, 'edge-1', 'success')
      useExecutionStore.getState().setEdgeRunStatus(wf, 'edge-2', 'error')

      const runEdges = useExecutionStore.getState().getWorkflowExecution(wf).lastRunEdges
      expect(runEdges.get('edge-1')).toBe('success')
      expect(runEdges.get('edge-2')).toBe('error')
      expect(runEdges.size).toBe(2)
    })
  })

  describe('clearRunPath', () => {
    it.concurrent('should clear both lastRunPath and lastRunEdges', () => {
      const wf = 'wf-clear-both'
      useExecutionStore.getState().setBlockRunStatus(wf, 'block-1', 'success')
      useExecutionStore.getState().setEdgeRunStatus(wf, 'edge-1', 'success')
      useExecutionStore.getState().clearRunPath(wf)

      const state = useExecutionStore.getState().getWorkflowExecution(wf)
      expect(state.lastRunPath.size).toBe(0)
      expect(state.lastRunEdges.size).toBe(0)
    })

    it.concurrent('should not affect other workflow state', () => {
      const wf = 'wf-clear-other'
      useExecutionStore.getState().setIsExecuting(wf, true)
      useExecutionStore.getState().setBlockRunStatus(wf, 'block-1', 'success')
      useExecutionStore.getState().clearRunPath(wf)

      const state = useExecutionStore.getState().getWorkflowExecution(wf)
      expect(state.isExecuting).toBe(true)
      expect(state.lastRunPath.size).toBe(0)
    })
  })

  describe('per-workflow isolation', () => {
    it.concurrent('should keep execution state independent between workflows', () => {
      const wfA = 'wf-iso-exec-a'
      const wfB = 'wf-iso-exec-b'

      useExecutionStore.getState().setIsExecuting(wfA, true)
      useExecutionStore.getState().setActiveBlocks(wfA, new Set(['block-a1']))

      useExecutionStore.getState().setIsExecuting(wfB, false)
      useExecutionStore.getState().setActiveBlocks(wfB, new Set(['block-b1', 'block-b2']))

      const stateA = useExecutionStore.getState().getWorkflowExecution(wfA)
      const stateB = useExecutionStore.getState().getWorkflowExecution(wfB)

      expect(stateA.isExecuting).toBe(true)
      expect(stateA.activeBlockIds.size).toBe(1)
      expect(stateA.activeBlockIds.has('block-a1')).toBe(true)

      expect(stateB.isExecuting).toBe(false)
      expect(stateB.activeBlockIds.size).toBe(2)
      expect(stateB.activeBlockIds.has('block-b1')).toBe(true)
    })

    it.concurrent('should keep run path independent between workflows', () => {
      const wfA = 'wf-iso-path-a'
      const wfB = 'wf-iso-path-b'

      useExecutionStore.getState().setBlockRunStatus(wfA, 'block-1', 'success')
      useExecutionStore.getState().setEdgeRunStatus(wfA, 'edge-1', 'success')

      useExecutionStore.getState().setBlockRunStatus(wfB, 'block-1', 'error')
      useExecutionStore.getState().setEdgeRunStatus(wfB, 'edge-1', 'error')

      const stateA = useExecutionStore.getState().getWorkflowExecution(wfA)
      const stateB = useExecutionStore.getState().getWorkflowExecution(wfB)

      expect(stateA.lastRunPath.get('block-1')).toBe('success')
      expect(stateA.lastRunEdges.get('edge-1')).toBe('success')

      expect(stateB.lastRunPath.get('block-1')).toBe('error')
      expect(stateB.lastRunEdges.get('edge-1')).toBe('error')
    })

    it.concurrent('should not affect workflow B when starting execution on workflow A', () => {
      const wfA = 'wf-iso-start-a'
      const wfB = 'wf-iso-start-b'

      useExecutionStore.getState().setBlockRunStatus(wfA, 'block-1', 'success')
      useExecutionStore.getState().setBlockRunStatus(wfB, 'block-1', 'success')

      useExecutionStore.getState().setIsExecuting(wfA, true)

      const stateA = useExecutionStore.getState().getWorkflowExecution(wfA)
      const stateB = useExecutionStore.getState().getWorkflowExecution(wfB)

      expect(stateA.lastRunPath.size).toBe(0)
      expect(stateB.lastRunPath.get('block-1')).toBe('success')
    })

    it.concurrent('should not affect workflow B when clearing run path on workflow A', () => {
      const wfA = 'wf-iso-clear-a'
      const wfB = 'wf-iso-clear-b'

      useExecutionStore.getState().setBlockRunStatus(wfA, 'block-1', 'success')
      useExecutionStore.getState().setBlockRunStatus(wfB, 'block-2', 'error')
      useExecutionStore.getState().clearRunPath(wfA)

      expect(useExecutionStore.getState().getWorkflowExecution(wfA).lastRunPath.size).toBe(0)
      expect(
        useExecutionStore.getState().getWorkflowExecution(wfB).lastRunPath.get('block-2')
      ).toBe('error')
    })
  })

  describe('execution snapshots', () => {
    const mockSnapshot = {
      blockStates: {},
      blockLogs: [],
      executionOrder: [],
    } as any

    it.concurrent('should store a snapshot', () => {
      const wf = 'wf-snap-store'
      useExecutionStore.getState().setLastExecutionSnapshot(wf, mockSnapshot)
      expect(useExecutionStore.getState().getLastExecutionSnapshot(wf)).toBe(mockSnapshot)
    })

    it.concurrent('should return undefined for unknown workflows', () => {
      expect(
        useExecutionStore.getState().getLastExecutionSnapshot('wf-snap-unknown')
      ).toBeUndefined()
    })

    it.concurrent('should clear a snapshot', () => {
      const wf = 'wf-snap-clear'
      useExecutionStore.getState().setLastExecutionSnapshot(wf, mockSnapshot)
      useExecutionStore.getState().clearLastExecutionSnapshot(wf)

      expect(useExecutionStore.getState().getLastExecutionSnapshot(wf)).toBeUndefined()
    })

    it.concurrent('should keep snapshots independent between workflows', () => {
      const wfA = 'wf-snap-iso-a'
      const wfB = 'wf-snap-iso-b'
      const snapshotB = { blockStates: { x: 1 } } as any

      useExecutionStore.getState().setLastExecutionSnapshot(wfA, mockSnapshot)
      useExecutionStore.getState().setLastExecutionSnapshot(wfB, snapshotB)

      expect(useExecutionStore.getState().getLastExecutionSnapshot(wfA)).toBe(mockSnapshot)
      expect(useExecutionStore.getState().getLastExecutionSnapshot(wfB)).toBe(snapshotB)
    })
  })

  describe('reset', () => {
    beforeEach(() => {
      useExecutionStore.setState(initialState)
    })

    it('should clear all workflow execution state', () => {
      useExecutionStore.getState().setIsExecuting('wf-reset-a', true)
      useExecutionStore.getState().setBlockRunStatus('wf-reset-a', 'block-1', 'success')
      useExecutionStore.getState().setLastExecutionSnapshot('wf-reset-a', {} as any)

      useExecutionStore.getState().reset()

      const state = useExecutionStore.getState()
      expect(state.workflowExecutions.size).toBe(0)
      expect(state.lastExecutionSnapshots.size).toBe(0)
    })

    it('should return defaults for all workflows after reset', () => {
      useExecutionStore.getState().setIsExecuting('wf-reset-b', true)
      useExecutionStore.getState().setIsExecuting('wf-reset-c', true)
      useExecutionStore.getState().reset()

      expect(useExecutionStore.getState().getWorkflowExecution('wf-reset-b').isExecuting).toBe(
        false
      )
      expect(useExecutionStore.getState().getWorkflowExecution('wf-reset-c').isExecuting).toBe(
        false
      )
    })
  })

  describe('immutability', () => {
    beforeEach(() => {
      useExecutionStore.setState(initialState)
    })

    it('should create a new workflowExecutions map on each mutation', () => {
      const mapBefore = useExecutionStore.getState().workflowExecutions

      useExecutionStore.getState().setIsExecuting('wf-immut-map', true)
      const mapAfter = useExecutionStore.getState().workflowExecutions

      expect(mapBefore).not.toBe(mapAfter)
    })

    it('should create a new lastRunPath map when adding block status', () => {
      const wf = 'wf-immut-path'
      useExecutionStore.getState().setBlockRunStatus(wf, 'block-1', 'success')
      const pathBefore = useExecutionStore.getState().getWorkflowExecution(wf).lastRunPath

      useExecutionStore.getState().setBlockRunStatus(wf, 'block-2', 'error')
      const pathAfter = useExecutionStore.getState().getWorkflowExecution(wf).lastRunPath

      expect(pathBefore).not.toBe(pathAfter)
      expect(pathBefore.size).toBe(1)
      expect(pathAfter.size).toBe(2)
    })

    it('should create a new lastRunEdges map when adding edge status', () => {
      const wf = 'wf-immut-edges'
      useExecutionStore.getState().setEdgeRunStatus(wf, 'edge-1', 'success')
      const edgesBefore = useExecutionStore.getState().getWorkflowExecution(wf).lastRunEdges

      useExecutionStore.getState().setEdgeRunStatus(wf, 'edge-2', 'error')
      const edgesAfter = useExecutionStore.getState().getWorkflowExecution(wf).lastRunEdges

      expect(edgesBefore).not.toBe(edgesAfter)
      expect(edgesBefore.size).toBe(1)
      expect(edgesAfter.size).toBe(2)
    })

    it.concurrent('should not mutate the default state constant', () => {
      useExecutionStore.getState().setBlockRunStatus('wf-immut-const', 'block-1', 'success')

      expect(defaultWorkflowExecutionState.lastRunPath.size).toBe(0)
      expect(defaultWorkflowExecutionState.lastRunEdges.size).toBe(0)
      expect(defaultWorkflowExecutionState.activeBlockIds.size).toBe(0)
    })
  })
})
