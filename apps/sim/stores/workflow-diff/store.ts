import { createLogger } from '@sim/logger'
import { create } from 'zustand'
import { devtools } from 'zustand/middleware'
import { getClientTool } from '@/lib/copilot/tools/client/manager'
import { stripWorkflowDiffMarkers, WorkflowDiffEngine } from '@/lib/workflows/diff'
import { enqueueReplaceWorkflowState } from '@/lib/workflows/operations/socket-operations'
import { validateWorkflowState } from '@/lib/workflows/sanitization/validation'
import { Serializer } from '@/serializer'
import { useWorkflowRegistry } from '../workflows/registry/store'
import { mergeSubblockState } from '../workflows/utils'
import { useWorkflowStore } from '../workflows/workflow/store'
import type { WorkflowDiffActions, WorkflowDiffState } from './types'
import {
  applyWorkflowStateToStores,
  captureBaselineSnapshot,
  cloneWorkflowState,
  createBatchedUpdater,
  findLatestEditWorkflowToolCallId,
  getLatestUserMessageId,
  persistWorkflowStateToServer,
} from './utils'

/** Get the active stream ID from copilot store (lazy import to avoid circular deps) */
async function getActiveStreamId(): Promise<string | null> {
  try {
    const { useCopilotStore } = await import('@/stores/panel/copilot/store')
    return useCopilotStore.getState().activeStreamId
  } catch {
    return null
  }
}

/** Save pending diff to server (Redis) via API */
async function savePendingDiffToServer(
  streamId: string,
  pendingDiff: {
    toolCallId: string
    baselineWorkflow: unknown
    proposedWorkflow: unknown
    diffAnalysis: unknown
  }
): Promise<void> {
  try {
    await fetch(`/api/copilot/stream/${streamId}/pending-diff`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({ pendingDiff }),
    })
  } catch (err) {
    logger.warn('Failed to save pending diff to server', { error: err })
  }
}

/** Clear pending diff from server (Redis) via API */
async function clearPendingDiffFromServer(streamId: string): Promise<void> {
  try {
    await fetch(`/api/copilot/stream/${streamId}/pending-diff`, {
      method: 'DELETE',
      credentials: 'include',
    })
  } catch {
    // Ignore errors - not critical
  }
}

const logger = createLogger('WorkflowDiffStore')
const diffEngine = new WorkflowDiffEngine()

/**
 * Detects when a diff contains no meaningful changes.
 */
function isEmptyDiffAnalysis(
  diffAnalysis?: {
    new_blocks?: string[]
    edited_blocks?: string[]
    deleted_blocks?: string[]
    field_diffs?: Record<string, { changed_fields: string[] }>
    edge_diff?: { new_edges?: string[]; deleted_edges?: string[] }
  } | null
): boolean {
  if (!diffAnalysis) return false
  const hasBlockChanges =
    (diffAnalysis.new_blocks?.length || 0) > 0 ||
    (diffAnalysis.edited_blocks?.length || 0) > 0 ||
    (diffAnalysis.deleted_blocks?.length || 0) > 0
  const hasEdgeChanges =
    (diffAnalysis.edge_diff?.new_edges?.length || 0) > 0 ||
    (diffAnalysis.edge_diff?.deleted_edges?.length || 0) > 0
  const hasFieldChanges = Object.values(diffAnalysis.field_diffs || {}).some(
    (diff) => (diff?.changed_fields?.length || 0) > 0
  )
  return !hasBlockChanges && !hasEdgeChanges && !hasFieldChanges
}

export const useWorkflowDiffStore = create<WorkflowDiffState & WorkflowDiffActions>()(
  devtools(
    (set, get) => {
      const batchedUpdate = createBatchedUpdater(set)

      return {
        hasActiveDiff: false,
        isShowingDiff: false,
        isDiffReady: false,
        baselineWorkflow: null,
        baselineWorkflowId: null,
        diffAnalysis: null,
        diffMetadata: null,
        diffError: null,
        _triggerMessageId: null,
        _batchedStateUpdate: batchedUpdate,

        setProposedChanges: async (proposedState, diffAnalysis) => {
          const activeWorkflowId = useWorkflowRegistry.getState().activeWorkflowId
          if (!activeWorkflowId) {
            logger.error('Cannot apply diff without an active workflow')
            throw new Error('No active workflow found')
          }

          // Capture baseline if needed (synchronous, fast)
          let baselineWorkflow = get().baselineWorkflow
          let baselineWorkflowId = get().baselineWorkflowId
          let capturedBaseline = false

          if (!baselineWorkflow || baselineWorkflowId !== activeWorkflowId) {
            baselineWorkflow = captureBaselineSnapshot(activeWorkflowId)
            baselineWorkflowId = activeWorkflowId
            capturedBaseline = true
            logger.info('Captured baseline snapshot for diff workflow', {
              workflowId: activeWorkflowId,
              blockCount: Object.keys(baselineWorkflow.blocks || {}).length,
            })
          }

          // Create diff (this is fast, just computes the diff)
          const diffResult = await diffEngine.createDiffFromWorkflowState(
            proposedState,
            diffAnalysis,
            baselineWorkflow ?? undefined
          )

          if (!diffResult.success || !diffResult.diff) {
            const errorMessage = diffResult.errors?.join(', ') || 'Failed to create diff'
            logger.error(errorMessage)
            throw new Error(errorMessage)
          }

          const diffAnalysisResult = diffResult.diff.diffAnalysis || null
          if (isEmptyDiffAnalysis(diffAnalysisResult)) {
            logger.info('No workflow diff detected; skipping diff view')
            diffEngine.clearDiff()
            batchedUpdate({
              hasActiveDiff: false,
              isShowingDiff: false,
              isDiffReady: false,
              baselineWorkflow: null,
              baselineWorkflowId: null,
              diffAnalysis: null,
              diffMetadata: null,
              diffError: null,
              _triggerMessageId: null,
            })
            return
          }

          const candidateState = diffResult.diff.proposedState

          // Validate proposed workflow using serializer round-trip
          const serializer = new Serializer()
          const serialized = serializer.serializeWorkflow(
            candidateState.blocks,
            candidateState.edges,
            candidateState.loops,
            candidateState.parallels,
            false
          )
          serializer.deserializeWorkflow(serialized)

          // OPTIMISTIC: Apply state immediately to stores (this is what makes UI update)
          applyWorkflowStateToStores(activeWorkflowId, candidateState)

          // OPTIMISTIC: Update diff state immediately so UI shows the diff
          const triggerMessageId =
            capturedBaseline && !get()._triggerMessageId
              ? await getLatestUserMessageId()
              : get()._triggerMessageId

          set({
            hasActiveDiff: true,
            isShowingDiff: true,
            isDiffReady: true,
            baselineWorkflow: baselineWorkflow,
            baselineWorkflowId,
            diffAnalysis: diffAnalysisResult,
            diffMetadata: diffResult.diff.metadata,
            diffError: null,
            _triggerMessageId: triggerMessageId ?? null,
          })

          if (triggerMessageId) {
            import('@/stores/panel/copilot/store')
              .then(({ useCopilotStore }) =>
                useCopilotStore.getState().saveMessageCheckpoint(triggerMessageId)
              )
              .catch((error) => {
                logger.warn('Failed to save checkpoint for diff', { error })
              })
          }

          logger.info('Workflow diff applied optimistically', {
            workflowId: activeWorkflowId,
            blocks: Object.keys(candidateState.blocks || {}).length,
            edges: candidateState.edges?.length || 0,
          })

          // Persist pending diff to Redis for resumption on page refresh
          getActiveStreamId().then((streamId) => {
            if (streamId) {
              findLatestEditWorkflowToolCallId().then((toolCallId) => {
                if (toolCallId) {
                  savePendingDiffToServer(streamId, {
                    toolCallId,
                    baselineWorkflow: baselineWorkflow,
                    proposedWorkflow: candidateState,
                    diffAnalysis: diffAnalysisResult,
                  })
                }
              })
            }
          })

          // NOTE: We do NOT broadcast to other users here (to prevent socket errors on refresh).
          // But we DO persist to database WITH diff markers so the proposed state survives page refresh
          // and the diff UI can be restored. Final broadcast (without markers) happens when user accepts.
          persistWorkflowStateToServer(activeWorkflowId, candidateState, { preserveDiffMarkers: true })
            .then((persisted) => {
              if (!persisted) {
                logger.warn('Failed to persist diff preview state')
              } else {
                logger.info('Diff preview state persisted with markers', { workflowId: activeWorkflowId })
              }
            })
            .catch((error) => {
              logger.warn('Failed to persist diff preview state', { error })
            })

          // Emit event for undo/redo recording
          if (!(window as any).__skipDiffRecording) {
            window.dispatchEvent(
              new CustomEvent('record-diff-operation', {
                detail: {
                  type: 'apply-diff',
                  baselineSnapshot: baselineWorkflow,
                  proposedState: candidateState,
                  diffAnalysis: diffResult.diff.diffAnalysis,
                },
              })
            )
          }
        },

        restoreDiffWithBaseline: (baselineWorkflow, proposedWorkflow, diffAnalysis) => {
          const activeWorkflowId = useWorkflowRegistry.getState().activeWorkflowId
          if (!activeWorkflowId) {
            logger.error('Cannot restore diff without an active workflow')
            return
          }

          logger.info('Restoring diff with baseline', {
            workflowId: activeWorkflowId,
            hasBaseline: !!baselineWorkflow,
            newBlocks: diffAnalysis.new_blocks?.length || 0,
            editedBlocks: diffAnalysis.edited_blocks?.length || 0,
          })

          // Set the diff state with the provided baseline
          batchedUpdate({
            hasActiveDiff: true,
            isShowingDiff: true,
            isDiffReady: true,
            baselineWorkflow: baselineWorkflow,
            baselineWorkflowId: activeWorkflowId,
            diffAnalysis: diffAnalysis,
            diffMetadata: null,
            diffError: null,
          })

          // The proposed workflow should already be applied (blocks have is_diff markers)
          // Just re-apply the markers to ensure they're visible
          setTimeout(() => get().reapplyDiffMarkers(), 0)
        },

        clearDiff: ({ restoreBaseline = true } = {}) => {
          const { baselineWorkflow, baselineWorkflowId } = get()
          const activeWorkflowId = useWorkflowRegistry.getState().activeWorkflowId

          if (
            restoreBaseline &&
            baselineWorkflow &&
            baselineWorkflowId &&
            baselineWorkflowId === activeWorkflowId
          ) {
            applyWorkflowStateToStores(baselineWorkflowId, baselineWorkflow)
          }

          diffEngine.clearDiff()

          batchedUpdate({
            hasActiveDiff: false,
            isShowingDiff: false,
            isDiffReady: false,
            baselineWorkflow: null,
            baselineWorkflowId: null,
            diffAnalysis: null,
            diffMetadata: null,
            diffError: null,
            _triggerMessageId: null,
          })
        },

        toggleDiffView: () => {
          const { hasActiveDiff, isDiffReady, isShowingDiff } = get()
          if (!hasActiveDiff) {
            logger.warn('Cannot toggle diff view without active diff')
            return
          }
          if (!isDiffReady) {
            logger.warn('Cannot toggle diff view before diff is ready')
            return
          }
          batchedUpdate({ isShowingDiff: !isShowingDiff })
        },

        acceptChanges: async () => {
          const activeWorkflowId = useWorkflowRegistry.getState().activeWorkflowId
          if (!activeWorkflowId) {
            logger.error('No active workflow ID found when accepting diff')
            throw new Error('No active workflow found')
          }

          const workflowStore = useWorkflowStore.getState()
          const currentState = workflowStore.getWorkflowState()
          const mergedBlocks = mergeSubblockState(
            currentState.blocks,
            activeWorkflowId ?? undefined
          )
          const mergedState = {
            ...currentState,
            blocks: mergedBlocks,
          }
          const cleanState = stripWorkflowDiffMarkers(cloneWorkflowState(mergedState))
          const validation = validateWorkflowState(cleanState, { sanitize: true })

          if (!validation.valid) {
            const errorMessage = `Cannot apply changes: ${validation.errors.join('; ')}`
            logger.error(errorMessage)
            batchedUpdate({ diffError: errorMessage })
            throw new Error(errorMessage)
          }

          const stateToApply = {
            ...(validation.sanitizedState || cleanState),
            lastSaved: useWorkflowStore.getState().lastSaved,
          }

          // Capture state before accept for undo
          const beforeAccept = cloneWorkflowState(mergedState)
          const afterAccept = cloneWorkflowState(stateToApply)
          const diffAnalysisForUndo = get().diffAnalysis
          const baselineForUndo = get().baselineWorkflow
          const triggerMessageId = get()._triggerMessageId

          // Clear pending diff from Redis (fire and forget)
          getActiveStreamId().then((streamId) => {
            if (streamId) {
              clearPendingDiffFromServer(streamId)
            }
          })

          // Clear diff state FIRST to prevent flash of colors
          // This must happen synchronously before applying the cleaned state
          set({
            hasActiveDiff: false,
            isShowingDiff: false,
            isDiffReady: false,
            baselineWorkflow: null,
            baselineWorkflowId: null,
            diffAnalysis: null,
            diffMetadata: null,
            diffError: null,
            _triggerMessageId: null,
          })

          // Clear the diff engine
          diffEngine.clearDiff()

          // Now apply the cleaned state
          applyWorkflowStateToStores(activeWorkflowId, stateToApply)

          // Broadcast and persist the accepted changes
          const cleanStateForBroadcast = stripWorkflowDiffMarkers(cloneWorkflowState(stateToApply))

          // Fire and forget: broadcast to other users
          enqueueReplaceWorkflowState({
            workflowId: activeWorkflowId,
            state: cleanStateForBroadcast,
          }).catch((error) => {
            logger.warn('Failed to broadcast accepted workflow state', { error })
          })

          // Fire and forget: persist to database
          persistWorkflowStateToServer(activeWorkflowId, stateToApply)
            .then((persisted) => {
              if (!persisted) {
                logger.warn('Failed to persist accepted workflow changes')
              } else {
                logger.info('Accepted workflow changes persisted to database', {
                  workflowId: activeWorkflowId,
                })
              }
            })
            .catch((error) => {
              logger.warn('Failed to persist accepted workflow state', { error })
            })

          // Emit event for undo/redo recording (unless we're in an undo/redo operation)
          if (!(window as any).__skipDiffRecording) {
            window.dispatchEvent(
              new CustomEvent('record-diff-operation', {
                detail: {
                  type: 'accept-diff',
                  beforeAccept,
                  afterAccept,
                  diffAnalysis: diffAnalysisForUndo,
                  baselineSnapshot: baselineForUndo,
                },
              })
            )
          }

          // Background operations (fire-and-forget) - don't block
          if (triggerMessageId) {
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

          findLatestEditWorkflowToolCallId().then((toolCallId) => {
            if (toolCallId) {
              getClientTool(toolCallId)
                ?.handleAccept?.()
                ?.catch?.((error: Error) => {
                  logger.warn('Failed to notify tool accept state', { error })
                })
            }
          })
        },

        rejectChanges: async () => {
          const { baselineWorkflow, baselineWorkflowId, _triggerMessageId, diffAnalysis } = get()
          const activeWorkflowId = useWorkflowRegistry.getState().activeWorkflowId

          if (!baselineWorkflow || !baselineWorkflowId) {
            logger.warn('Reject called without baseline workflow - cannot revert changes')
            // This can happen if the diff was restored from markers after page refresh
            // without a saved baseline. Just clear the diff markers without reverting.
            get().clearDiff({ restoreBaseline: false })
            // Show a notification to the user
            try {
              const { useNotificationStore } = await import('@/stores/notifications')
              useNotificationStore.getState().addNotification({
                level: 'info',
                message:
                  'Cannot revert: The original workflow state was lost after page refresh. Diff markers have been cleared.',
              })
            } catch {}
            return
          }

          if (!activeWorkflowId || activeWorkflowId !== baselineWorkflowId) {
            logger.warn('Reject called while viewing a different workflow', {
              activeWorkflowId,
              baselineWorkflowId,
            })
            get().clearDiff({ restoreBaseline: false })
            return
          }

          // Capture current state (with markers) before rejecting
          const workflowStore = useWorkflowStore.getState()
          const currentState = workflowStore.getWorkflowState()
          const mergedBlocks = mergeSubblockState(
            currentState.blocks,
            activeWorkflowId ?? undefined
          )
          const beforeReject = cloneWorkflowState({
            ...currentState,
            blocks: mergedBlocks,
          })
          const afterReject = cloneWorkflowState(baselineWorkflow)

          // Clear pending diff from Redis (fire and forget)
          getActiveStreamId().then((streamId) => {
            if (streamId) {
              clearPendingDiffFromServer(streamId)
            }
          })

          // Clear diff state FIRST for instant UI feedback
          set({
            hasActiveDiff: false,
            isShowingDiff: false,
            isDiffReady: false,
            baselineWorkflow: null,
            baselineWorkflowId: null,
            diffAnalysis: null,
            diffMetadata: null,
            diffError: null,
            _triggerMessageId: null,
          })

          // Clear the diff engine
          diffEngine.clearDiff()

          // Apply baseline state locally
          applyWorkflowStateToStores(baselineWorkflowId, baselineWorkflow)

          // Emit event for undo/redo recording synchronously
          if (!(window as any).__skipDiffRecording) {
            window.dispatchEvent(
              new CustomEvent('record-diff-operation', {
                detail: {
                  type: 'reject-diff',
                  beforeReject,
                  afterReject,
                  diffAnalysis,
                  baselineSnapshot: baselineWorkflow,
                },
              })
            )
          }

          // Background operations (fire-and-forget) - don't block UI
          // Broadcast to other users
          logger.info('Broadcasting reject to other users', {
            workflowId: activeWorkflowId,
            blockCount: Object.keys(baselineWorkflow.blocks).length,
          })

          enqueueReplaceWorkflowState({
            workflowId: activeWorkflowId,
            state: baselineWorkflow,
          }).catch((error) => {
            logger.error('Failed to broadcast reject to other users:', error)
          })

          // Persist to database in background
          persistWorkflowStateToServer(baselineWorkflowId, baselineWorkflow).catch((error) => {
            logger.error('Failed to persist baseline workflow state:', error)
          })

          if (_triggerMessageId) {
            fetch('/api/copilot/stats', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                messageId: _triggerMessageId,
                diffCreated: true,
                diffAccepted: false,
              }),
            }).catch(() => {})
          }

          findLatestEditWorkflowToolCallId().then((toolCallId) => {
            if (toolCallId) {
              getClientTool(toolCallId)
                ?.handleReject?.()
                ?.catch?.((error: Error) => {
                  logger.warn('Failed to notify tool reject state', { error })
                })
            }
          })
        },

        reapplyDiffMarkers: () => {
          const { hasActiveDiff, isDiffReady, diffAnalysis } = get()
          if (!hasActiveDiff || !isDiffReady || !diffAnalysis) {
            return
          }

          const workflowStore = useWorkflowStore.getState()
          const currentBlocks = workflowStore.blocks

          // Check if any blocks need markers applied (checking the actual property, not just existence)
          const needsUpdate =
            diffAnalysis.new_blocks?.some((blockId) => {
              const block = currentBlocks[blockId]
              return block && (block as any).is_diff !== 'new'
            }) ||
            diffAnalysis.edited_blocks?.some((blockId) => {
              const block = currentBlocks[blockId]
              return block && (block as any).is_diff !== 'edited'
            })

          if (!needsUpdate) {
            return
          }

          const updatedBlocks: Record<string, any> = {}
          let hasChanges = false

          // Only clone blocks that need diff markers
          Object.entries(currentBlocks).forEach(([blockId, block]) => {
            const isNewBlock = diffAnalysis.new_blocks?.includes(blockId)
            const isEditedBlock = diffAnalysis.edited_blocks?.includes(blockId)

            if (isNewBlock && (block as any).is_diff !== 'new') {
              updatedBlocks[blockId] = { ...block, is_diff: 'new' }
              hasChanges = true
            } else if (isEditedBlock && (block as any).is_diff !== 'edited') {
              updatedBlocks[blockId] = { ...block, is_diff: 'edited' }

              // Re-apply field_diffs if available
              if (diffAnalysis.field_diffs?.[blockId]) {
                updatedBlocks[blockId].field_diffs = diffAnalysis.field_diffs[blockId]

                // Clone subblocks and apply markers
                const fieldDiff = diffAnalysis.field_diffs[blockId]
                updatedBlocks[blockId].subBlocks = { ...block.subBlocks }

                fieldDiff.changed_fields.forEach((field) => {
                  if (updatedBlocks[blockId].subBlocks?.[field]) {
                    updatedBlocks[blockId].subBlocks[field] = {
                      ...updatedBlocks[blockId].subBlocks[field],
                      is_diff: 'changed',
                    }
                  }
                })
              }
              hasChanges = true
            } else {
              updatedBlocks[blockId] = block
            }
          })

          // Only update if we actually made changes
          if (hasChanges) {
            useWorkflowStore.setState({ blocks: updatedBlocks })
            logger.info('Re-applied diff markers to workflow blocks')
          }
        },

        restoreDiffFromMarkers: () => {
          // Check if the workflow has any blocks with is_diff markers
          // If so, restore the diff store state to show the diff view
          const { hasActiveDiff } = get()
          if (hasActiveDiff) {
            // Already have an active diff
            return
          }

          const workflowStore = useWorkflowStore.getState()
          const blocks = workflowStore.blocks

          const newBlocks: string[] = []
          const editedBlocks: string[] = []
          const fieldDiffs: Record<string, { changed_fields: string[] }> = {}

          Object.entries(blocks).forEach(([blockId, block]) => {
            const isDiff = (block as any).is_diff
            if (isDiff === 'new') {
              newBlocks.push(blockId)
            } else if (isDiff === 'edited') {
              editedBlocks.push(blockId)
              // Check for field diffs
              const blockFieldDiffs = (block as any).field_diffs
              if (blockFieldDiffs) {
                fieldDiffs[blockId] = blockFieldDiffs
              } else {
                // Check subBlocks for is_diff markers
                const changedFields: string[] = []
                Object.entries((block as any).subBlocks || {}).forEach(
                  ([fieldId, subBlock]: [string, any]) => {
                    if (subBlock?.is_diff === 'changed') {
                      changedFields.push(fieldId)
                    }
                  }
                )
                if (changedFields.length > 0) {
                  fieldDiffs[blockId] = { changed_fields: changedFields }
                }
              }
            }
          })

          if (newBlocks.length === 0 && editedBlocks.length === 0) {
            // No diff markers found
            return
          }

          logger.info('Restoring diff state from markers', {
            newBlocks: newBlocks.length,
            editedBlocks: editedBlocks.length,
          })

          // Restore the diff state
          // Note: We don't have the baseline, so reject will just clear the diff
          // Add unchanged_fields to satisfy the type (we don't track unchanged fields on restore)
          const fieldDiffsWithUnchanged: Record<
            string,
            { changed_fields: string[]; unchanged_fields: string[] }
          > = {}
          Object.entries(fieldDiffs).forEach(([blockId, diff]) => {
            fieldDiffsWithUnchanged[blockId] = {
              changed_fields: diff.changed_fields,
              unchanged_fields: [],
            }
          })

          const diffAnalysis = {
            new_blocks: newBlocks,
            edited_blocks: editedBlocks,
            deleted_blocks: [],
            field_diffs: fieldDiffsWithUnchanged,
          }

          const activeWorkflowId = useWorkflowRegistry.getState().activeWorkflowId

          batchedUpdate({
            hasActiveDiff: true,
            isShowingDiff: true,
            isDiffReady: true,
            baselineWorkflow: null, // We don't have baseline on restore from markers alone
            baselineWorkflowId: activeWorkflowId, // Set the workflow ID for later baseline restoration
            diffAnalysis,
            diffMetadata: null,
            diffError: null,
          })
        },
      }
    },
    { name: 'workflow-diff-store' }
  )
)
