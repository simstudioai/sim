import { create } from 'zustand'
import { devtools } from 'zustand/middleware'
import { getClientTool } from '@/lib/copilot/tools/client/manager'
import { createLogger } from '@/lib/logs/console/logger'
import {
  type DiffAnalysis,
  stripWorkflowDiffMarkers,
  type WorkflowDiff,
  WorkflowDiffEngine,
} from '@/lib/workflows/diff'
import { validateWorkflowState } from '@/lib/workflows/validation'
import { Serializer } from '@/serializer'
import { useWorkflowRegistry } from '../workflows/registry/store'
import { useSubBlockStore } from '../workflows/subblock/store'
import { mergeSubblockState } from '../workflows/utils'
import { useWorkflowStore } from '../workflows/workflow/store'
import type { WorkflowState } from '../workflows/workflow/types'

const logger = createLogger('WorkflowDiffStore')
const diffEngine = new WorkflowDiffEngine()

let updateTimer: NodeJS.Timeout | null = null
const UPDATE_DEBOUNCE_MS = 16

function cloneWorkflowState(state: WorkflowState): WorkflowState {
  return {
    ...state,
    blocks: structuredClone(state.blocks || {}),
    edges: structuredClone(state.edges || []),
    loops: structuredClone(state.loops || {}),
    parallels: structuredClone(state.parallels || {}),
  }
}

function extractSubBlockValues(workflowState: WorkflowState): Record<string, Record<string, any>> {
  const values: Record<string, Record<string, any>> = {}
  Object.entries(workflowState.blocks || {}).forEach(([blockId, block]) => {
    values[blockId] = {}
    Object.entries(block.subBlocks || {}).forEach(([subBlockId, subBlock]) => {
      values[blockId][subBlockId] = (subBlock as any)?.value ?? null
    })
  })
  return values
}

function applyWorkflowStateToStores(
  workflowId: string,
  workflowState: WorkflowState,
  options?: { updateLastSaved?: boolean }
) {
  const workflowStore = useWorkflowStore.getState()
  workflowStore.replaceWorkflowState(cloneWorkflowState(workflowState), options)
  const subBlockValues = extractSubBlockValues(workflowState)
  useSubBlockStore.getState().setWorkflowValues(workflowId, subBlockValues)
}

function captureBaselineSnapshot(workflowId: string): WorkflowState {
  const workflowStore = useWorkflowStore.getState()
  const currentState = workflowStore.getWorkflowState()
  const mergedBlocks = mergeSubblockState(currentState.blocks, workflowId)

  return {
    ...cloneWorkflowState(currentState),
    blocks: structuredClone(mergedBlocks),
  }
}

async function persistWorkflowStateToServer(
  workflowId: string,
  workflowState: WorkflowState
): Promise<boolean> {
  try {
    const cleanState = stripWorkflowDiffMarkers(cloneWorkflowState(workflowState))
    const response = await fetch(`/api/workflows/${workflowId}/state`, {
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
      const errorText = await response.text().catch(() => '')
      throw new Error(errorText || 'Failed to persist workflow state')
    }

    const activeWorkflowId = useWorkflowRegistry.getState().activeWorkflowId
    if (activeWorkflowId === workflowId) {
      useWorkflowStore.setState({ lastSaved: Date.now() })
    }

    return true
  } catch (error) {
    logger.error('Failed to persist workflow state after copilot edit', error)
    return false
  }
}

async function getLatestUserMessageId(): Promise<string | null> {
  try {
    const { useCopilotStore } = await import('@/stores/panel-new/copilot/store')
    const { messages } = useCopilotStore.getState() as any
    if (!Array.isArray(messages) || messages.length === 0) {
      return null
    }

    for (let i = messages.length - 1; i >= 0; i--) {
      const m = messages[i]
      if (m?.role === 'user' && m?.id) {
        return m.id
      }
    }
  } catch (error) {
    logger.warn('Failed to capture trigger message id', { error })
  }
  return null
}

async function findLatestEditWorkflowToolCallId(): Promise<string | undefined> {
  try {
    const { useCopilotStore } = await import('@/stores/panel-new/copilot/store')
    const { messages, toolCallsById } = useCopilotStore.getState() as any

    for (let mi = messages.length - 1; mi >= 0; mi--) {
      const message = messages[mi]
      if (message.role !== 'assistant' || !message.contentBlocks) continue
      for (const block of message.contentBlocks as any[]) {
        if (block?.type === 'tool_call' && block.toolCall?.name === 'edit_workflow') {
          return block.toolCall?.id
        }
      }
    }

    const fallback = Object.values(toolCallsById).filter(
      (call: any) => call.name === 'edit_workflow'
    ) as any[]

    return fallback.length ? fallback[fallback.length - 1].id : undefined
  } catch (error) {
    logger.warn('Failed to resolve edit_workflow tool call id', { error })
    return undefined
  }
}

function createBatchedUpdater(set: any) {
  let pendingUpdates: Partial<WorkflowDiffState> = {}
  return (updates: Partial<WorkflowDiffState>) => {
    Object.assign(pendingUpdates, updates)
    if (updateTimer) {
      clearTimeout(updateTimer)
    }
    updateTimer = setTimeout(() => {
      set(pendingUpdates)
      pendingUpdates = {}
      updateTimer = null
    }, UPDATE_DEBOUNCE_MS)
  }
}

interface WorkflowDiffState {
  hasActiveDiff: boolean
  isShowingDiff: boolean
  isDiffReady: boolean
  baselineWorkflow: WorkflowState | null
  baselineWorkflowId: string | null
  diffAnalysis: DiffAnalysis | null
  diffMetadata: WorkflowDiff['metadata'] | null
  diffError?: string | null
  _triggerMessageId?: string | null
}

interface WorkflowDiffActions {
  setProposedChanges: (workflowState: WorkflowState, diffAnalysis?: DiffAnalysis) => Promise<void>
  clearDiff: (options?: { restoreBaseline?: boolean }) => void
  toggleDiffView: () => void
  acceptChanges: () => Promise<void>
  rejectChanges: () => Promise<void>
  _batchedStateUpdate: (updates: Partial<WorkflowDiffState>) => void
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

          const previousState = cloneWorkflowState(useWorkflowStore.getState().getWorkflowState())
          batchedUpdate({ isDiffReady: false, diffError: null })

          let baselineWorkflow = get().baselineWorkflow
          let baselineWorkflowId = get().baselineWorkflowId
          let capturedBaseline = false

          if (!baselineWorkflow || baselineWorkflowId !== activeWorkflowId) {
            try {
              baselineWorkflow = captureBaselineSnapshot(activeWorkflowId)
              baselineWorkflowId = activeWorkflowId
              capturedBaseline = true
              logger.info('Captured baseline snapshot for diff workflow', {
                workflowId: activeWorkflowId,
                blockCount: Object.keys(baselineWorkflow.blocks || {}).length,
              })
            } catch (error) {
              const message = 'Failed to capture workflow snapshot before applying diff'
              logger.error(message, { error })
              batchedUpdate({ diffError: message, isDiffReady: false })
              throw error instanceof Error ? error : new Error(message)
            }
          }

          try {
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

            const candidateState = diffResult.diff.proposedState

            // Validate proposed workflow using serializer round-trip
            try {
              const serializer = new Serializer()
              const serialized = serializer.serializeWorkflow(
                candidateState.blocks,
                candidateState.edges,
                candidateState.loops,
                candidateState.parallels,
                false
              )
              serializer.deserializeWorkflow(serialized)
            } catch (error) {
              const message =
                error instanceof Error ? error.message : 'Invalid workflow in proposed changes'
              logger.error('[DiffStore] Diff validation failed', { message, error })
              throw new Error(message)
            }

            applyWorkflowStateToStores(activeWorkflowId, candidateState)
            const persisted = await persistWorkflowStateToServer(activeWorkflowId, candidateState)

            if (!persisted) {
              logger.error('Failed to persist copilot edits, restoring previous workflow state')
              applyWorkflowStateToStores(activeWorkflowId, previousState)
              batchedUpdate({
                hasActiveDiff: Boolean(baselineWorkflow),
                isShowingDiff: Boolean(baselineWorkflow),
                isDiffReady: Boolean(baselineWorkflow),
                diffError: 'Failed to save Copilot changes. Please try again.',
              })
              throw new Error('Failed to save Copilot changes')
            }

            const triggerMessageId =
              capturedBaseline && !get()._triggerMessageId
                ? await getLatestUserMessageId()
                : get()._triggerMessageId

            batchedUpdate({
              hasActiveDiff: true,
              isShowingDiff: true,
              isDiffReady: true,
              baselineWorkflow: baselineWorkflow,
              baselineWorkflowId,
              diffAnalysis: diffResult.diff.diffAnalysis || null,
              diffMetadata: diffResult.diff.metadata,
              diffError: null,
              _triggerMessageId: triggerMessageId ?? null,
            })

            logger.info('Workflow diff applied and persisted to main store', {
              workflowId: activeWorkflowId,
              blocks: Object.keys(candidateState.blocks || {}).length,
              edges: candidateState.edges?.length || 0,
            })
          } catch (error) {
            logger.error('Failed to set proposed changes', { error })
            if (capturedBaseline) {
              batchedUpdate({
                baselineWorkflow: null,
                baselineWorkflowId: null,
                hasActiveDiff: false,
                isShowingDiff: false,
              })
            }
            const message =
              error instanceof Error ? error.message : 'Failed to create workflow diff'
            batchedUpdate({ diffError: message, isDiffReady: false })
            throw error
          }
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
          const cleanState = stripWorkflowDiffMarkers(cloneWorkflowState(currentState))
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
          applyWorkflowStateToStores(activeWorkflowId, stateToApply)

          const triggerMessageId = get()._triggerMessageId
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

          const toolCallId = await findLatestEditWorkflowToolCallId()
          if (toolCallId) {
            try {
              await getClientTool(toolCallId)?.handleAccept?.()
            } catch (error) {
              logger.warn('Failed to notify tool accept state', { error })
            }
          }

          get().clearDiff({ restoreBaseline: false })
        },

        rejectChanges: async () => {
          const { baselineWorkflow, baselineWorkflowId, _triggerMessageId } = get()
          const activeWorkflowId = useWorkflowRegistry.getState().activeWorkflowId

          if (!baselineWorkflow || !baselineWorkflowId) {
            logger.warn('Reject called without baseline workflow')
            get().clearDiff({ restoreBaseline: false })
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

          applyWorkflowStateToStores(baselineWorkflowId, baselineWorkflow)

          const persisted = await persistWorkflowStateToServer(baselineWorkflowId, baselineWorkflow)
          if (!persisted) {
            throw new Error('Failed to restore baseline workflow state')
          }

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

          const toolCallId = await findLatestEditWorkflowToolCallId()
          if (toolCallId) {
            try {
              await getClientTool(toolCallId)?.handleReject?.()
            } catch (error) {
              logger.warn('Failed to notify tool reject state', { error })
            }
          }

          get().clearDiff({ restoreBaseline: false })
        },
      }
    },
    { name: 'workflow-diff-store' }
  )
)
