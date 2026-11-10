import { omit } from '@sim/utils/object'
import { create } from 'zustand'
import { devtools } from 'zustand/middleware'
import type {
  WorkflowReconciliationActions,
  WorkflowReconciliationState,
} from '@/stores/workflow-reconciliation/types'

export const useWorkflowReconciliationStore = create<
  WorkflowReconciliationState & WorkflowReconciliationActions
>()(
  devtools(
    (set, get) => ({
      pendingExternalUpdates: {},
      remoteUpdateVersions: {},
      reconcilingWorkflows: {},
      reconciliationErrors: {},

      markRemoteUpdateSeen: (workflowId) => {
        set((state) => ({
          remoteUpdateVersions: {
            ...state.remoteUpdateVersions,
            [workflowId]: (state.remoteUpdateVersions[workflowId] ?? 0) + 1,
          },
          reconciliationErrors: omit(state.reconciliationErrors, [workflowId]),
        }))
      },

      markExternalUpdatePending: (workflowId) => {
        const current = get()
        set({
          pendingExternalUpdates: {
            ...current.pendingExternalUpdates,
            [workflowId]: (current.pendingExternalUpdates[workflowId] ?? 0) + 1,
          },
          remoteUpdateVersions: {
            ...current.remoteUpdateVersions,
            [workflowId]: (current.remoteUpdateVersions[workflowId] ?? 0) + 1,
          },
          reconciliationErrors: omit(current.reconciliationErrors, [workflowId]),
        })
      },

      clearExternalUpdatePending: (workflowId) => {
        set((state) => {
          const { [workflowId]: _removed, ...pendingExternalUpdates } = state.pendingExternalUpdates
          return { pendingExternalUpdates }
        })
      },

      setWorkflowReconciliationInProgress: (workflowId, isReconciling) => {
        set((state) => {
          const { [workflowId]: _removed, ...reconcilingWorkflows } = state.reconcilingWorkflows
          return {
            reconcilingWorkflows: isReconciling
              ? { ...reconcilingWorkflows, [workflowId]: true }
              : reconcilingWorkflows,
          }
        })
      },

      setWorkflowReconciliationError: (workflowId, error) => {
        set((state) => {
          const { [workflowId]: _removed, ...reconciliationErrors } = state.reconciliationErrors
          return {
            reconciliationErrors: error
              ? { ...reconciliationErrors, [workflowId]: error }
              : reconciliationErrors,
          }
        })
      },
    }),
    { name: 'workflow-reconciliation-store' }
  )
)
