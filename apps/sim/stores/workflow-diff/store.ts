import { create } from 'zustand'
import { devtools } from 'zustand/middleware'
import { createLogger } from '@/lib/logs/console/logger'
import { type DiffAnalysis, WorkflowDiffEngine } from '@/lib/workflows/diff'
import { useWorkflowRegistry } from '../workflows/registry/store'
import { useSubBlockStore } from '../workflows/subblock/store'
import { useWorkflowStore } from '../workflows/workflow/store'
import type { WorkflowState } from '../workflows/workflow/types'

const logger = createLogger('WorkflowDiffStore')

// PERFORMANCE OPTIMIZATION: Singleton diff engine instance with caching
const diffEngine = new WorkflowDiffEngine()

// PERFORMANCE OPTIMIZATION: Debounced state updates for better performance
let updateTimer: NodeJS.Timeout | null = null
const UPDATE_DEBOUNCE_MS = 16 // ~60fps

// PERFORMANCE OPTIMIZATION: Cached state selectors to prevent unnecessary recalculations
const stateSelectors = {
  workflowState: null as WorkflowState | null,
  lastWorkflowStateHash: '',

  getWorkflowState(): WorkflowState {
    const current = useWorkflowStore.getState().getWorkflowState()
    const currentHash = JSON.stringify({
      blocksLength: Object.keys(current.blocks).length,
      edgesLength: current.edges.length,
      timestamp: current.lastSaved,
    })

    if (currentHash !== this.lastWorkflowStateHash) {
      this.workflowState = current
      this.lastWorkflowStateHash = currentHash
    }

    return this.workflowState!
  },
}

interface WorkflowDiffState {
  isShowingDiff: boolean
  isDiffReady: boolean // New flag to track when diff is fully ready
  diffWorkflow: WorkflowState | null
  diffAnalysis: DiffAnalysis | null
  diffMetadata: {
    source: string
    timestamp: number
  } | null
  // PERFORMANCE OPTIMIZATION: Cache frequently accessed computed values
  _cachedDisplayState?: WorkflowState
  _lastDisplayStateHash?: string
}

interface WorkflowDiffActions {
  setProposedChanges: (yamlContent: string, diffAnalysis?: DiffAnalysis) => Promise<void>
  mergeProposedChanges: (yamlContent: string, diffAnalysis?: DiffAnalysis) => Promise<void>
  clearDiff: () => void
  getCurrentWorkflowForCanvas: () => WorkflowState
  toggleDiffView: () => void
  acceptChanges: () => Promise<void>
  rejectChanges: () => Promise<void>
  // PERFORMANCE OPTIMIZATION: Batched state updates
  _batchedStateUpdate: (updates: Partial<WorkflowDiffState>) => void
}

/**
 * PERFORMANCE OPTIMIZATION: Batched state update function
 */
function createBatchedUpdater(set: any) {
  let pendingUpdates: Partial<WorkflowDiffState> = {}

  return (updates: Partial<WorkflowDiffState>) => {
    // Merge updates
    Object.assign(pendingUpdates, updates)

    // Clear existing timer
    if (updateTimer) {
      clearTimeout(updateTimer)
    }

    // Schedule batched update
    updateTimer = setTimeout(() => {
      const finalUpdates = { ...pendingUpdates }
      pendingUpdates = {}
      updateTimer = null

      set(finalUpdates)
    }, UPDATE_DEBOUNCE_MS)
  }
}

/**
 * Optimized diff store with performance enhancements
 */
export const useWorkflowDiffStore = create<WorkflowDiffState & WorkflowDiffActions>()(
  devtools(
    (set, get) => {
      // PERFORMANCE OPTIMIZATION: Create batched updater once
      const batchedUpdate = createBatchedUpdater(set)

      return {
        isShowingDiff: false,
        isDiffReady: false,
        diffWorkflow: null,
        diffAnalysis: null,
        diffMetadata: null,
        _cachedDisplayState: undefined,
        _lastDisplayStateHash: undefined,

        _batchedStateUpdate: batchedUpdate,

        setProposedChanges: async (yamlContent: string, diffAnalysis?: DiffAnalysis) => {
          // PERFORMANCE OPTIMIZATION: Immediate state update to prevent UI flicker
          batchedUpdate({ isDiffReady: false })

          const result = await diffEngine.createDiffFromYaml(yamlContent, diffAnalysis)

          if (result.success && result.diff) {
            // PERFORMANCE OPTIMIZATION: Log diff analysis efficiently
            if (result.diff.diffAnalysis) {
              const analysis = result.diff.diffAnalysis
              logger.info('[DiffStore] Diff analysis:', {
                new: analysis.new_blocks,
                edited: analysis.edited_blocks,
                deleted: analysis.deleted_blocks,
                total: Object.keys(result.diff.proposedState.blocks).length,
              })
            }

            // PERFORMANCE OPTIMIZATION: Single batched state update
            batchedUpdate({
              isShowingDiff: true,
              isDiffReady: true,
              diffWorkflow: result.diff.proposedState,
              diffAnalysis: result.diff.diffAnalysis || null,
              diffMetadata: result.diff.metadata,
              _cachedDisplayState: undefined, // Clear cache
              _lastDisplayStateHash: undefined,
            })

            logger.info('Diff created successfully')
          } else {
            logger.error('Failed to create diff:', result.errors)
            batchedUpdate({ isDiffReady: false })
            throw new Error(result.errors?.join(', ') || 'Failed to create diff')
          }
        },

        mergeProposedChanges: async (yamlContent: string, diffAnalysis?: DiffAnalysis) => {
          logger.info('Merging proposed changes via YAML')

          // First, set isDiffReady to false to prevent premature rendering
          batchedUpdate({ isDiffReady: false })

          const result = await diffEngine.mergeDiffFromYaml(yamlContent, diffAnalysis)

          if (result.success && result.diff) {
            // Set all state at once, with isDiffReady true
            batchedUpdate({
              isShowingDiff: true,
              isDiffReady: true, // Now it's safe to render
              diffWorkflow: result.diff.proposedState,
              diffAnalysis: result.diff.diffAnalysis || null,
              diffMetadata: result.diff.metadata,
            })
            logger.info('Diff merged successfully')
          } else {
            logger.error('Failed to merge diff:', result.errors)
            // Reset isDiffReady on failure
            batchedUpdate({ isDiffReady: false })
            throw new Error(result.errors?.join(', ') || 'Failed to merge diff')
          }
        },

        clearDiff: () => {
          logger.info('Clearing diff')
          diffEngine.clearDiff()
          batchedUpdate({
            isShowingDiff: false,
            isDiffReady: false, // Reset ready flag
            diffWorkflow: null,
            diffAnalysis: null,
            diffMetadata: null,
          })
        },

        toggleDiffView: () => {
          const { isShowingDiff, isDiffReady } = get()
          logger.info('Toggling diff view', { currentState: isShowingDiff, isDiffReady })

          // Only toggle if diff is ready or we're turning off diff view
          if (!isShowingDiff || isDiffReady) {
            batchedUpdate({ isShowingDiff: !isShowingDiff })
          } else {
            logger.warn('Cannot toggle to diff view - diff not ready')
          }
        },

        acceptChanges: async () => {
          const activeWorkflowId = useWorkflowRegistry.getState().activeWorkflowId

          if (!activeWorkflowId) {
            logger.error('No active workflow ID found when accepting diff')
            throw new Error('No active workflow found')
          }

          logger.info('Accepting proposed changes')

          try {
            const cleanState = diffEngine.acceptDiff()
            if (!cleanState) {
              logger.warn('No diff to accept')
              return
            }

            // Update the main workflow store state
            useWorkflowStore.setState({
              blocks: cleanState.blocks,
              edges: cleanState.edges,
              loops: cleanState.loops,
              parallels: cleanState.parallels,
            })

            // Update the subblock store with the values from the diff workflow blocks
            const subblockValues: Record<string, Record<string, any>> = {}

            Object.entries(cleanState.blocks).forEach(([blockId, block]) => {
              subblockValues[blockId] = {}
              Object.entries(block.subBlocks || {}).forEach(([subblockId, subblock]) => {
                subblockValues[blockId][subblockId] = (subblock as any).value
              })
            })

            useSubBlockStore.setState((state) => ({
              workflowValues: {
                ...state.workflowValues,
                [activeWorkflowId]: subblockValues,
              },
            }))

            // Trigger save and history
            const workflowStore = useWorkflowStore.getState()
            workflowStore.updateLastSaved()

            logger.info('Successfully applied diff workflow to main store')

            // Persist to database
            try {
              logger.info('Persisting accepted diff changes to database')

              const response = await fetch(`/api/workflows/${activeWorkflowId}/state`, {
                method: 'PUT',
                headers: {
                  'Content-Type': 'application/json',
                },
                body: JSON.stringify({
                  ...cleanState,
                  lastSaved: Date.now(),
                }),
              })

              if (!response.ok) {
                const errorData = await response.json()
                logger.error('Failed to persist accepted diff to database:', errorData)
                throw new Error(errorData.error || `Failed to save: ${response.statusText}`)
              }

              const result = await response.json()
              logger.info('Successfully persisted accepted diff to database', {
                blocksCount: result.blocksCount,
                edgesCount: result.edgesCount,
              })
            } catch (persistError) {
              logger.error('Failed to persist accepted diff to database:', persistError)
              // Don't throw here - the store is already updated, so the UI is correct
              logger.warn('Diff was applied to local stores but not persisted to database')
            }

            // Clear the diff
            get().clearDiff()

            // Update copilot tool call state to 'accepted'
            try {
              const { useCopilotStore } = await import('@/stores/copilot/store')
              useCopilotStore.getState().updatePreviewToolCallState('accepted')
            } catch (error) {
              logger.warn('Failed to update copilot tool call state after accept:', error)
            }
          } catch (error) {
            logger.error('Failed to accept changes:', error)
            throw error
          }
        },

        rejectChanges: async () => {
          logger.info('Rejecting proposed changes')
          get().clearDiff()

          // Update copilot tool call state to 'rejected'
          try {
            const { useCopilotStore } = await import('@/stores/copilot/store')
            useCopilotStore.getState().updatePreviewToolCallState('rejected')
          } catch (error) {
            logger.warn('Failed to update copilot tool call state after reject:', error)
          }
        },

        getCurrentWorkflowForCanvas: () => {
          const state = get()
          const { isShowingDiff, isDiffReady, _cachedDisplayState, _lastDisplayStateHash } = state

          // PERFORMANCE OPTIMIZATION: Return cached display state if available and valid
          if (isShowingDiff && isDiffReady && diffEngine.hasDiff()) {
            const currentState = stateSelectors.getWorkflowState()
            const currentHash = stateSelectors.lastWorkflowStateHash

            // Use cached display state if hash matches
            if (_cachedDisplayState && _lastDisplayStateHash === currentHash) {
              return _cachedDisplayState
            }

            // Generate and cache new display state
            logger.debug('Returning diff workflow for canvas')
            const displayState = diffEngine.getDisplayState(currentState)

            // Cache the result for future calls
            state._batchedStateUpdate({
              _cachedDisplayState: displayState,
              _lastDisplayStateHash: currentHash,
            })

            return displayState
          }

          // PERFORMANCE OPTIMIZATION: Use cached workflow state selector
          return stateSelectors.getWorkflowState()
        },
      }
    },
    { name: 'workflow-diff-store' }
  )
)
