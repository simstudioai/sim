/**
 * @vitest-environment node
 *
 * Tests for the workflow-diff store's status modeling.
 *
 * Focus: the {@link WorkflowDiffStatus} enum is the single source of truth and
 * the legacy `hasActiveDiff` / `isShowingDiff` / `isDiffReady` booleans are
 * derived from it, so contradictory combinations are unrepresentable. We assert
 * the exhaustive status → boolean mapping and the status transitions driven by
 * the tractable actions (`toggleDiffView`, `clearDiff`, `_batchedStateUpdate`).
 *
 * @remarks
 * The store transitively imports the diff engine, serializer, socket
 * operations, and the workflow/registry stores, all of which drag in the block
 * registry and emcn icon CSS. Every such dependency is mocked so the suite
 * loads under the node environment and exercises only the store + its types.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'

const { applyWorkflowStateToStores } = vi.hoisted(() => ({
  applyWorkflowStateToStores: vi.fn(),
}))

vi.mock('@/lib/workflows/diff', () => ({
  WorkflowDiffEngine: class {
    clearDiff = vi.fn()
    createDiffFromWorkflowState = vi.fn()
  },
  stripWorkflowDiffMarkers: vi.fn((s) => s),
}))

vi.mock('@/lib/workflows/operations/socket-operations', () => ({
  enqueueReplaceWorkflowState: vi.fn().mockResolvedValue(undefined),
}))

vi.mock('@/lib/workflows/sanitization/validation', () => ({
  validateWorkflowState: vi.fn(() => ({ valid: true, errors: [], sanitizedState: null })),
}))

vi.mock('@/serializer', () => ({
  Serializer: class {
    serializeWorkflow = vi.fn()
    deserializeWorkflow = vi.fn()
  },
}))

vi.mock('@/stores/workflows/registry/store', () => ({
  useWorkflowRegistry: { getState: vi.fn(() => ({ activeWorkflowId: null })) },
}))

vi.mock('@/stores/workflows/utils', () => ({
  mergeSubblockState: vi.fn((blocks) => blocks),
}))

vi.mock('@/stores/workflows/workflow/store', () => ({
  useWorkflowStore: {
    getState: vi.fn(() => ({
      getWorkflowState: vi.fn(() => ({ blocks: {}, edges: [], loops: {}, parallels: {} })),
      blocks: {},
      lastSaved: 0,
    })),
    setState: vi.fn(),
  },
}))

vi.mock('@/stores/workflow-diff/utils', () => ({
  applyWorkflowStateToStores,
  captureBaselineSnapshot: vi.fn(),
  cloneWorkflowState: vi.fn((s) => s),
  createBatchedUpdater:
    (set: (u: Record<string, unknown>) => void) => (updates: Record<string, unknown>) =>
      set(updates),
  getLatestUserMessageId: vi.fn().mockResolvedValue(null),
  persistWorkflowStateToServer: vi.fn().mockResolvedValue(true),
  WORKFLOW_DIFF_SETTLED_EVENT: 'workflow-diff-settled',
}))

import { RESET_DIFF_STATE, useWorkflowDiffStore } from '@/stores/workflow-diff/store'
import {
  deriveDiffFlags,
  type WorkflowDiffState,
  type WorkflowDiffStatus,
} from '@/stores/workflow-diff/types'

function seedStatus(status: WorkflowDiffStatus): void {
  useWorkflowDiffStore.setState(deriveDiffFlags(status))
}

describe('useWorkflowDiffStore status modeling', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    useWorkflowDiffStore.setState({
      ...RESET_DIFF_STATE,
      pendingExternalUpdates: {},
      remoteUpdateVersions: {},
      reconcilingWorkflows: {},
      reconciliationErrors: {},
    } as Partial<WorkflowDiffState>)
  })

  describe('deriveDiffFlags', () => {
    it('maps every status to the documented legacy booleans', () => {
      expect(deriveDiffFlags('none')).toEqual({
        status: 'none',
        hasActiveDiff: false,
        isShowingDiff: false,
        isDiffReady: false,
      })
      expect(deriveDiffFlags('staged')).toEqual({
        status: 'staged',
        hasActiveDiff: true,
        isShowingDiff: false,
        isDiffReady: true,
      })
      expect(deriveDiffFlags('showing')).toEqual({
        status: 'showing',
        hasActiveDiff: true,
        isShowingDiff: true,
        isDiffReady: true,
      })
    })

    it('keeps hasActiveDiff and isDiffReady in lockstep (legacy invariant)', () => {
      for (const status of ['none', 'staged', 'showing'] as const) {
        const flags = deriveDiffFlags(status)
        expect(flags.hasActiveDiff).toBe(flags.isDiffReady)
      }
    })
  })

  describe('initial / reset state', () => {
    it('starts in the none-derived state', () => {
      const state = useWorkflowDiffStore.getState()
      expect(state.status).toBe('none')
      expect(state.hasActiveDiff).toBe(false)
      expect(state.isShowingDiff).toBe(false)
      expect(state.isDiffReady).toBe(false)
    })

    it('RESET_DIFF_STATE carries the none-derived flags and clears diff payload', () => {
      expect(RESET_DIFF_STATE.status).toBe('none')
      expect(RESET_DIFF_STATE.hasActiveDiff).toBe(false)
      expect(RESET_DIFF_STATE.isShowingDiff).toBe(false)
      expect(RESET_DIFF_STATE.isDiffReady).toBe(false)
      expect(RESET_DIFF_STATE.baselineWorkflow).toBeNull()
      expect(RESET_DIFF_STATE.diffAnalysis).toBeNull()
    })
  })

  describe('toggleDiffView', () => {
    it('is a guarded no-op when there is no active diff', () => {
      seedStatus('none')
      useWorkflowDiffStore.getState().toggleDiffView()
      expect(useWorkflowDiffStore.getState().status).toBe('none')
    })

    it('toggles showing → staged (hides the proposed changes)', () => {
      seedStatus('showing')
      useWorkflowDiffStore.getState().toggleDiffView()

      const state = useWorkflowDiffStore.getState()
      expect(state.status).toBe('staged')
      expect(state.hasActiveDiff).toBe(true)
      expect(state.isDiffReady).toBe(true)
      expect(state.isShowingDiff).toBe(false)
    })

    it('toggles staged → showing (reveals the proposed changes)', () => {
      seedStatus('staged')
      useWorkflowDiffStore.getState().toggleDiffView()

      const state = useWorkflowDiffStore.getState()
      expect(state.status).toBe('showing')
      expect(state.isShowingDiff).toBe(true)
    })
  })

  describe('clearDiff', () => {
    it('returns the store to the none status', () => {
      seedStatus('showing')
      useWorkflowDiffStore.getState().clearDiff({ restoreBaseline: false })

      const state = useWorkflowDiffStore.getState()
      expect(state.status).toBe('none')
      expect(state.hasActiveDiff).toBe(false)
      expect(state.isShowingDiff).toBe(false)
      expect(state.isDiffReady).toBe(false)
    })
  })

  describe('_batchedStateUpdate (undo/redo writer)', () => {
    it('restores the showing status via deriveDiffFlags', () => {
      seedStatus('none')
      useWorkflowDiffStore.getState()._batchedStateUpdate({
        ...deriveDiffFlags('showing'),
        baselineWorkflow: null,
        baselineWorkflowId: 'wf-1',
      })

      const state = useWorkflowDiffStore.getState()
      expect(state.status).toBe('showing')
      expect(state.hasActiveDiff).toBe(true)
      expect(state.isShowingDiff).toBe(true)
      expect(state.isDiffReady).toBe(true)
    })

    it('the derived booleans always agree with the stored status', () => {
      for (const status of ['none', 'staged', 'showing', 'none'] as const) {
        seedStatus(status)
        const state = useWorkflowDiffStore.getState()
        expect({
          hasActiveDiff: state.hasActiveDiff,
          isShowingDiff: state.isShowingDiff,
          isDiffReady: state.isDiffReady,
        }).toEqual({
          hasActiveDiff: deriveDiffFlags(status).hasActiveDiff,
          isShowingDiff: deriveDiffFlags(status).isShowingDiff,
          isDiffReady: deriveDiffFlags(status).isDiffReady,
        })
      }
    })
  })
})
