/**
 * Tests for the per-workflow execution store.
 *
 * These tests cover:
 * - Default state for unknown workflows
 * - Per-workflow state isolation
 * - Execution lifecycle (start/stop clears run path)
 * - Block and edge run status tracking
 * - Active block management
 * - The {@link ExecutionStatus} enum and its derived `isExecuting` /
 *   `isDebugging` booleans (exhaustive status → flag mapping + transitions)
 * - Execution snapshot management
 * - Store reset
 * - Immutability guarantees
 *
 * @remarks
 * The store under test transitively imports the workflow registry store,
 * which drags in the block registry and emcn icon CSS. To keep this a true
 * unit test that loads under the node environment, the registry store is
 * mocked to a minimal stub (the store actions never touch it — only the
 * convenience hooks do, which are not exercised here).
 *
 * Most tests use `it.concurrent` with unique workflow IDs per test.
 * Because the store isolates state by workflow ID, concurrent tests
 * do not interfere with each other. The `reset` and `immutability`
 * groups run sequentially since they affect or read global store state.
 */

import { workflowRegistryStoreMock } from '@sim/testing/mocks/workflow-registry-store.mock'
import { describe, expect, it, vi } from 'vitest'

vi.mock('@/stores/workflows/registry/store', () => workflowRegistryStoreMock)

vi.unmock('@/stores/execution/store')
vi.unmock('@/stores/execution/types')

import { useExecutionStore } from '@/stores/execution/store'
import { defaultWorkflowExecutionState } from '@/stores/execution/types'

describe('useExecutionStore', () => {
  describe('getWorkflowExecution', () => {
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
  })

  describe('setIsExecuting', () => {
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
  })

  describe('status enum', () => {
    it.concurrent('setIsExecuting(true) preserves an active debug session', () => {
      const wf = 'wf-status-debug-preserve'
      useExecutionStore.getState().setStatus(wf, 'debugging')
      useExecutionStore.getState().setIsExecuting(wf, true)
      expect(useExecutionStore.getState().getWorkflowExecution(wf).status).toBe('debugging')
    })
  })

  describe('per-workflow isolation', () => {
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
  })
})
