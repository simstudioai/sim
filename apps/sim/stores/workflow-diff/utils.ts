import { createLogger } from '@sim/logger'
import { stripWorkflowDiffMarkers } from '@/lib/workflows/diff'
import { useWorkflowRegistry } from '../workflows/registry/store'
import { useSubBlockStore } from '../workflows/subblock/store'
import { mergeSubblockState } from '../workflows/utils'
import { useWorkflowStore } from '../workflows/workflow/store'
import type { WorkflowState } from '../workflows/workflow/types'
import type { WorkflowDiffState } from './types'

const logger = createLogger('WorkflowDiffStore')

export function cloneWorkflowState(state: WorkflowState): WorkflowState {
  return {
    ...state,
    blocks: structuredClone(state.blocks || {}),
    edges: structuredClone(state.edges || []),
    loops: structuredClone(state.loops || {}),
    parallels: structuredClone(state.parallels || {}),
  }
}

export function extractSubBlockValues(
  workflowState: WorkflowState
): Record<string, Record<string, any>> {
  const values: Record<string, Record<string, any>> = {}
  Object.entries(workflowState.blocks || {}).forEach(([blockId, block]) => {
    values[blockId] = {}
    Object.entries(block.subBlocks || {}).forEach(([subBlockId, subBlock]) => {
      values[blockId][subBlockId] = subBlock?.value ?? null
    })
  })
  return values
}

export function applyWorkflowStateToStores(
  workflowId: string,
  workflowState: WorkflowState,
  options?: { updateLastSaved?: boolean }
) {
  logger.debug('[applyWorkflowStateToStores] Applying state', {
    workflowId,
    blockCount: Object.keys(workflowState.blocks || {}).length,
    edgeCount: workflowState.edges?.length ?? 0,
    edgePreview: workflowState.edges?.slice(0, 3).map((e) => `${e.source} -> ${e.target}`),
  })
  const workflowStore = useWorkflowStore.getState()
  const cloned = cloneWorkflowState(workflowState)
  logger.debug('[applyWorkflowStateToStores] Cloned state edges', {
    clonedEdgeCount: cloned.edges?.length ?? 0,
  })
  workflowStore.replaceWorkflowState(cloned, options)
  const subBlockValues = extractSubBlockValues(workflowState)
  useSubBlockStore.getState().setWorkflowValues(workflowId, subBlockValues)

  // Verify what's in the store after apply
  const afterState = workflowStore.getWorkflowState()
  logger.info('[applyWorkflowStateToStores] Applied workflow state to stores', {
    workflowId,
    afterEdgeCount: afterState.edges?.length ?? 0,
  })
}

export function captureBaselineSnapshot(workflowId: string): WorkflowState {
  const workflowStore = useWorkflowStore.getState()
  const currentState = workflowStore.getWorkflowState()
  const mergedBlocks = mergeSubblockState(currentState.blocks, workflowId)

  return {
    ...cloneWorkflowState(currentState),
    blocks: structuredClone(mergedBlocks),
  }
}

export async function persistWorkflowStateToServer(
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

export async function getLatestUserMessageId(): Promise<string | null> {
  try {
    const { useCopilotStore } = await import('@/stores/panel/copilot/store')
    const { messages } = useCopilotStore.getState()
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

export async function findLatestEditWorkflowToolCallId(): Promise<string | undefined> {
  return findLatestWorkflowEditToolCallId()
}

function isWorkflowEditToolCall(name?: string, params?: Record<string, unknown>): boolean {
  if (name === 'edit_workflow') return true
  if (name !== 'workflow_change') return false

  const mode = typeof params?.mode === 'string' ? params.mode.toLowerCase() : ''
  if (mode === 'apply') return true

  // Be permissive for legacy/incomplete events: apply calls always include proposalId.
  return typeof params?.proposalId === 'string' && params.proposalId.length > 0
}

export async function findLatestWorkflowEditToolCallId(): Promise<string | undefined> {
  try {
    const { useCopilotStore } = await import('@/stores/panel/copilot/store')
    const { messages, toolCallsById } = useCopilotStore.getState()

    for (let mi = messages.length - 1; mi >= 0; mi--) {
      const message = messages[mi]
      if (message.role !== 'assistant' || !message.contentBlocks) continue
      for (const block of message.contentBlocks) {
        if (
          block?.type === 'tool_call' &&
          isWorkflowEditToolCall(block.toolCall?.name, block.toolCall?.params)
        ) {
          return block.toolCall?.id
        }
      }
    }

    const fallback = Object.values(toolCallsById).filter((call) =>
      isWorkflowEditToolCall(call.name, call.params)
    )

    return fallback.length ? fallback[fallback.length - 1].id : undefined
  } catch (error) {
    logger.warn('Failed to resolve workflow edit tool call id', { error })
    return undefined
  }
}

export function createBatchedUpdater(set: (updates: Partial<WorkflowDiffState>) => void) {
  let updateTimer: NodeJS.Timeout | null = null
  const UPDATE_DEBOUNCE_MS = 16
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
