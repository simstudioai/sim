import { createLogger } from '@sim/logger'
import { create } from 'zustand'
import { devtools, persist } from 'zustand/middleware'
import { useUndoRedoStore } from '@/stores/undo-redo'
import type { UndoRedoState } from '@/stores/undo-redo/types'
import type { WorkflowHistoryState, WorkflowSnapshot } from '@/stores/workflow-history/types'
import { MAX_SNAPSHOTS_PER_WORKFLOW, MAX_TRACKED_WORKFLOWS } from '@/stores/workflow-history/types'
import { useSubBlockStore } from '@/stores/workflows/subblock/store'
import { useWorkflowStore } from '@/stores/workflows/workflow/store'

const logger = createLogger('WorkflowHistoryStore')

const OPERATION_LABELS: Record<string, string> = {
  'batch-add-blocks': 'Added blocks',
  'batch-remove-blocks': 'Removed blocks',
  'batch-add-edges': 'Added connections',
  'batch-remove-edges': 'Removed connections',
  'batch-move-blocks': 'Moved blocks',
  'update-parent': 'Moved to subflow',
  'batch-update-parent': 'Moved to subflow',
  'batch-toggle-enabled': 'Toggled enabled',
  'batch-toggle-handles': 'Toggled handles',
  'batch-toggle-locked': 'Toggled locked',
  'apply-diff': 'Applied changes',
  'accept-diff': 'Accepted changes',
  'reject-diff': 'Rejected changes',
}

function generateSnapshotId(): string {
  return `snap_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`
}

function captureSubBlockValues(workflowId: string): Record<string, Record<string, unknown>> {
  const workflowValues = useSubBlockStore.getState().workflowValues
  const values = workflowValues[workflowId]
  if (!values) return {}
  return JSON.parse(JSON.stringify(values))
}

function enforceLRU(
  snapshots: Record<string, WorkflowSnapshot[]>
): Record<string, WorkflowSnapshot[]> {
  const workflowIds = Object.keys(snapshots)
  if (workflowIds.length <= MAX_TRACKED_WORKFLOWS) return snapshots

  const sorted = workflowIds
    .map((id) => ({
      id,
      latest: snapshots[id]?.[0]?.timestamp ?? '',
    }))
    .sort((a, b) => b.latest.localeCompare(a.latest))

  const keepers = new Set(sorted.slice(0, MAX_TRACKED_WORKFLOWS).map((s) => s.id))
  const pruned: Record<string, WorkflowSnapshot[]> = {}
  for (const id of keepers) {
    pruned[id] = snapshots[id]
  }
  return pruned
}

export const useWorkflowHistoryStore = create<WorkflowHistoryState>()(
  devtools(
    persist(
      (set, get) => ({
        snapshots: {},

        captureSnapshot: (workflowId: string, label: string) => {
          try {
            const workflowState = useWorkflowStore.getState().getWorkflowState()
            const blocks = workflowState.blocks
            const edges = workflowState.edges

            if (Object.keys(blocks).length === 0) return

            const subBlockValues = captureSubBlockValues(workflowId)

            const snapshot: WorkflowSnapshot = {
              id: generateSnapshotId(),
              timestamp: new Date().toISOString(),
              label,
              blocks: JSON.parse(JSON.stringify(blocks)),
              edges: JSON.parse(JSON.stringify(edges)),
              subBlockValues,
            }

            set((state) => {
              const existing = state.snapshots[workflowId] ?? []

              if (existing.length > 0) {
                const latest = existing[0]
                const timeDiff = Date.now() - new Date(latest.timestamp).getTime()
                if (
                  timeDiff < 2000 &&
                  latest.label === label &&
                  Object.keys(latest.blocks).length === Object.keys(blocks).length &&
                  latest.edges.length === edges.length
                ) {
                  return state
                }
              }

              const updated = [snapshot, ...existing].slice(0, MAX_SNAPSHOTS_PER_WORKFLOW)

              return {
                snapshots: enforceLRU({
                  ...state.snapshots,
                  [workflowId]: updated,
                }),
              }
            })
          } catch (error) {
            logger.error('Failed to capture workflow snapshot', { workflowId, error })
          }
        },

        restoreSnapshot: (workflowId: string, snapshotId: string): boolean => {
          try {
            const snapshots = get().snapshots[workflowId] ?? []
            const snapshot = snapshots.find((s) => s.id === snapshotId)
            if (!snapshot) {
              logger.warn('Snapshot not found', { workflowId, snapshotId })
              return false
            }

            get().captureSnapshot(workflowId, 'Before restore')

            const workflowStore = useWorkflowStore.getState()
            workflowStore.replaceWorkflowState({
              blocks: JSON.parse(JSON.stringify(snapshot.blocks)),
              edges: JSON.parse(JSON.stringify(snapshot.edges)),
              loops: {},
              parallels: {},
            })

            const subBlockStore = useSubBlockStore.getState()
            for (const [blockId, values] of Object.entries(snapshot.subBlockValues)) {
              for (const [subBlockId, value] of Object.entries(values as Record<string, unknown>)) {
                subBlockStore.setValue(blockId, subBlockId, value)
              }
            }

            logger.info('Restored workflow to snapshot', {
              workflowId,
              snapshotId,
              label: snapshot.label,
            })
            return true
          } catch (error) {
            logger.error('Failed to restore workflow snapshot', { workflowId, snapshotId, error })
            return false
          }
        },

        getSnapshots: (workflowId: string): WorkflowSnapshot[] => {
          return get().snapshots[workflowId] ?? []
        },

        clearHistory: (workflowId: string) => {
          set((state) => {
            const { [workflowId]: _, ...rest } = state.snapshots
            return { snapshots: rest }
          })
        },

        clearAllHistory: () => {
          set({ snapshots: {} })
        },
      }),
      {
        name: 'workflow-history',
        partialize: (state) => ({ snapshots: state.snapshots }),
      }
    ),
    { name: 'workflow-history-store' }
  )
)

if (typeof window !== 'undefined') {
  const prevStackSizes: Record<string, number> = {}

  useUndoRedoStore.subscribe((state: UndoRedoState) => {
    for (const [key, stack] of Object.entries(state.stacks)) {
      const prevSize = prevStackSizes[key] ?? 0
      const currentSize = stack.undo.length

      if (currentSize > prevSize && currentSize > 0) {
        const latestEntry = stack.undo[stack.undo.length - 1]
        if (latestEntry) {
          const workflowId = key.split(':')[0]
          const label = OPERATION_LABELS[latestEntry.operation.type] ?? 'Changed workflow'
          useWorkflowHistoryStore.getState().captureSnapshot(workflowId, label)
        }
      }

      prevStackSizes[key] = currentSize
    }
  })
}
