import { create } from 'zustand'
import { devtools } from 'zustand/middleware'
import { getClientTool } from '@/lib/copilot/tools/client/manager'
import { createLogger } from '@/lib/logs/console/logger'
import { type DiffAnalysis, type WorkflowDiff, WorkflowDiffEngine } from '@/lib/workflows/diff'
import { validateWorkflowState } from '@/lib/workflows/validation'
import { Serializer } from '@/serializer'
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
  // Store validation error when proposed diff is invalid for the canvas
  diffError?: string | null
  // PERFORMANCE OPTIMIZATION: Cache frequently accessed computed values
  _cachedDisplayState?: WorkflowState
  _lastDisplayStateHash?: string
  // Track the user message id that triggered the current diff (for stats correlation)
  _triggerMessageId?: string | null
}

interface WorkflowDiffActions {
  setProposedChanges: (jsonContent: string, diffAnalysis?: DiffAnalysis) => Promise<void>
  mergeProposedChanges: (jsonContent: string, diffAnalysis?: DiffAnalysis) => Promise<void>
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
        diffError: null,
        _cachedDisplayState: undefined,
        _lastDisplayStateHash: undefined,
        _triggerMessageId: null,

        _batchedStateUpdate: batchedUpdate,

        setProposedChanges: async (
          proposedContent: string | WorkflowState,
          diffAnalysis?: DiffAnalysis
        ) => {
          // PERFORMANCE OPTIMIZATION: Immediate state update to prevent UI flicker
          batchedUpdate({ isDiffReady: false, diffError: null })

          // Clear any existing diff state to ensure a fresh start
          diffEngine.clearDiff()

          let result: { success: boolean; diff?: WorkflowDiff; errors?: string[] }

          // Handle both JSON string and direct WorkflowState object
          if (typeof proposedContent === 'string') {
            // JSON string path (for backward compatibility)
            result = await diffEngine.createDiff(proposedContent, diffAnalysis)
          } else {
            // Direct WorkflowState path (new, more efficient)
            result = await diffEngine.createDiffFromWorkflowState(proposedContent, diffAnalysis)
          }

          if (result.success && result.diff) {
            // Validate proposed workflow using serializer round-trip to catch canvas-breaking issues
            try {
              const proposed = result.diff.proposedState
              const serializer = new Serializer()
              const serialized = serializer.serializeWorkflow(
                proposed.blocks,
                proposed.edges,
                proposed.loops,
                proposed.parallels,
                false // do not enforce user-only required params at diff time
              )
              // Ensure we can deserialize back without errors
              serializer.deserializeWorkflow(serialized)
            } catch (e: any) {
              const message =
                e instanceof Error ? e.message : 'Invalid workflow in proposed changes'
              logger.error('[DiffStore] Diff validation failed:', { message, error: e })
              // Do not mark ready; store error and keep diff hidden
              batchedUpdate({ isDiffReady: false, diffError: message, isShowingDiff: false })
              return
            }

            // Attempt to capture the triggering user message id from copilot store
            let triggerMessageId: string | null = null
            try {
              const { useCopilotStore } = await import('@/stores/copilot/store')
              const { messages } = useCopilotStore.getState() as any
              if (Array.isArray(messages) && messages.length > 0) {
                for (let i = messages.length - 1; i >= 0; i--) {
                  const m = messages[i]
                  if (m?.role === 'user' && m?.id) {
                    triggerMessageId = m.id
                    break
                  }
                }
              }
            } catch {}

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
              diffError: null,
              _cachedDisplayState: undefined, // Clear cache
              _lastDisplayStateHash: undefined,
              _triggerMessageId: triggerMessageId,
            })

            logger.info('Diff created successfully')
          } else {
            logger.error('Failed to create diff:', result.errors)
            batchedUpdate({
              isDiffReady: false,
              diffError: result.errors?.join(', ') || 'Failed to create diff',
            })
            throw new Error(result.errors?.join(', ') || 'Failed to create diff')
          }
        },

        mergeProposedChanges: async (jsonContent: string, diffAnalysis?: DiffAnalysis) => {
          logger.info('Merging proposed changes from workflow state')

          // First, set isDiffReady to false to prevent premature rendering
          batchedUpdate({ isDiffReady: false, diffError: null })

          const result = await diffEngine.mergeDiff(jsonContent, diffAnalysis)

          if (result.success && result.diff) {
            // Validate proposed workflow using serializer round-trip to catch canvas-breaking issues
            try {
              const proposed = result.diff.proposedState
              const serializer = new Serializer()
              const serialized = serializer.serializeWorkflow(
                proposed.blocks,
                proposed.edges,
                proposed.loops,
                proposed.parallels,
                false
              )
              serializer.deserializeWorkflow(serialized)
            } catch (e: any) {
              const message =
                e instanceof Error ? e.message : 'Invalid workflow in proposed changes'
              logger.error('[DiffStore] Diff validation failed on merge:', { message, error: e })
              batchedUpdate({ isDiffReady: false, diffError: message, isShowingDiff: false })
              return
            }

            // Set all state at once, with isDiffReady true
            batchedUpdate({
              isShowingDiff: true,
              isDiffReady: true, // Now it's safe to render
              diffWorkflow: result.diff.proposedState,
              diffAnalysis: result.diff.diffAnalysis || null,
              diffMetadata: result.diff.metadata,
              diffError: null,
            })
            logger.info('Diff merged successfully')
          } else {
            logger.error('Failed to merge diff:', result.errors)
            // Reset isDiffReady on failure
            batchedUpdate({
              isDiffReady: false,
              diffError: result.errors?.join(', ') || 'Failed to merge diff',
            })
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
            diffError: null,
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

            // Validate the clean state before applying
            const validation = validateWorkflowState(cleanState, { sanitize: true })

            if (!validation.valid) {
              logger.error('Cannot accept diff - workflow state is invalid', {
                errors: validation.errors,
                warnings: validation.warnings,
              })

              // Show error to user
              batchedUpdate({
                diffError: `Cannot apply changes: ${validation.errors.join('; ')}`,
                isDiffReady: false,
              })

              // Clear the diff to prevent further attempts
              diffEngine.clearDiff()

              throw new Error(`Invalid workflow: ${validation.errors.join('; ')}`)
            }

            // Use sanitized state if available
            const stateToApply = validation.sanitizedState || cleanState

            if (validation.warnings.length > 0) {
              logger.warn('Workflow validation warnings during diff acceptance', {
                warnings: validation.warnings,
              })
            }

            // Immediately flag diffAccepted on stats if we can (early upsert with minimal fields)
            try {
              const { useCopilotStore } = await import('@/stores/copilot/store')
              const { currentChat } = useCopilotStore.getState() as any
              const triggerMessageId = get()._triggerMessageId
              if (currentChat?.id && triggerMessageId) {
                fetch('/api/copilot/stats', {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({
                    messageId: triggerMessageId,
                    diffCreated: true,
                    diffAccepted: true,
                  }),
                }).catch(() => {})
              }
            } catch {}

            // Update the main workflow store state
            useWorkflowStore.setState({
              blocks: stateToApply.blocks,
              edges: stateToApply.edges,
              loops: stateToApply.loops,
              parallels: stateToApply.parallels,
            })

            // Update the subblock store with the values from the diff workflow blocks
            const subblockValues: Record<string, Record<string, any>> = {}

            Object.entries(stateToApply.blocks).forEach(([blockId, block]) => {
              subblockValues[blockId] = {}
              Object.entries(block.subBlocks || {}).forEach(([subblockId, subblock]) => {
                subblockValues[blockId][subblockId] = subblock.value
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

            // Optimistically clear the diff immediately so UI updates instantly
            get().clearDiff()

            // Fire-and-forget: persist to database and update copilot state in the background

            ;(async () => {
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
                  const errorData = await response.json().catch(() => ({}))
                  logger.error('Failed to persist accepted diff to database:', errorData)
                } else {
                  const result = await response.json().catch(() => ({}))
                  logger.info('Successfully persisted accepted diff to database', {
                    blocksCount: (result as any)?.blocksCount,
                    edgesCount: (result as any)?.edgesCount,
                  })
                }
              } catch (persistError) {
                logger.error('Failed to persist accepted diff to database:', persistError)
                logger.warn('Diff was applied to local stores but not persisted to database')
              }

              // Update copilot tool call state to 'accepted'
              try {
                const { useCopilotStore } = await import('@/stores/copilot/store')
                const { messages, toolCallsById } = useCopilotStore.getState()

                // Prefer the latest assistant message's build/edit tool_call from contentBlocks
                let toolCallId: string | undefined
                outer: for (let mi = messages.length - 1; mi >= 0; mi--) {
                  const m = messages[mi] as any
                  if (m.role !== 'assistant' || !m.contentBlocks) continue
                  for (const b of m.contentBlocks as any[]) {
                    if (b?.type === 'tool_call') {
                      const tn = b.toolCall?.name
                      if (tn === 'edit_workflow') {
                        toolCallId = b.toolCall?.id
                        break outer
                      }
                    }
                  }
                }
                // Fallback to toolCallsById map if not found in messages
                if (!toolCallId) {
                  const candidates = Object.values(toolCallsById).filter(
                    (t: any) => t.name === 'edit_workflow'
                  ) as any[]
                  toolCallId = candidates.length ? candidates[candidates.length - 1].id : undefined
                }

                if (toolCallId) {
                  const instance: any = getClientTool(toolCallId)
                  try {
                    await instance?.handleAccept?.()
                  } catch (e) {
                    logger.warn('Failed to mark tool complete on accept', e)
                  }
                }
              } catch (error) {
                logger.warn('Failed to update copilot tool call state after accept:', error)
              }
            })()
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
            const { currentChat, messages, toolCallsById } = useCopilotStore.getState() as any

            // Post early diffAccepted=false if we have trigger + chat
            try {
              const triggerMessageId = get()._triggerMessageId
              if (currentChat?.id && triggerMessageId) {
                fetch('/api/copilot/stats', {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({
                    messageId: triggerMessageId,
                    diffCreated: true,
                    diffAccepted: false,
                  }),
                }).catch(() => {})
              }
            } catch {}

            // Prefer the latest assistant message's build/edit tool_call from contentBlocks
            let toolCallId: string | undefined
            outer: for (let mi = messages.length - 1; mi >= 0; mi--) {
              const m = messages[mi] as any
              if (m.role !== 'assistant' || !m.contentBlocks) continue
              for (const b of m.contentBlocks as any[]) {
                if (b?.type === 'tool_call') {
                  const tn = b.toolCall?.name
                  if (tn === 'edit_workflow') {
                    toolCallId = b.toolCall?.id
                    break outer
                  }
                }
              }
            }
            // Fallback to toolCallsById map if not found in messages
            if (!toolCallId) {
              const candidates = Object.values(toolCallsById).filter(
                (t: any) => t.name === 'edit_workflow'
              ) as any[]
              toolCallId = candidates.length ? candidates[candidates.length - 1].id : undefined
            }

            if (toolCallId) {
              const instance: any = getClientTool(toolCallId)
              try {
                await instance?.handleReject?.()
              } catch (e) {
                logger.warn('Failed to mark tool complete on reject', e)
              }
            }
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
