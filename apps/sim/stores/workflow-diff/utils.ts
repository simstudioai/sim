import { createLogger } from '@sim/logger'
import type { Edge } from 'reactflow'
import { ApiClientError } from '@/lib/api/client/errors'
import { requestJson } from '@/lib/api/client/request'
import {
  putWorkflowNormalizedStateContract,
  type WorkflowStateContractInput,
} from '@/lib/api/contracts/workflows'
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
    const { dragStartPosition: _dropDragStart, ...stateToSave } = cleanState

    type ContractEdgeInput = WorkflowStateContractInput['edges'][number]

    // Mirror auto-layout-utils sanitization: schema rejects nullable
    // sourceHandle/targetHandle (input type is `string | undefined`), but the
    // store's Edge type carries `string | null | undefined`. Drop nulls before
    // sending so the contract input parses cleanly.
    const sanitizedEdges: ContractEdgeInput[] = (stateToSave.edges || []).map((edge: Edge) => {
      const { sourceHandle, targetHandle, ...rest } = edge
      const sanitized: ContractEdgeInput = { ...rest } as ContractEdgeInput
      if (typeof sourceHandle === 'string' && sourceHandle.length > 0) {
        sanitized.sourceHandle = sourceHandle
      }
      if (typeof targetHandle === 'string' && targetHandle.length > 0) {
        sanitized.targetHandle = targetHandle
      }
      return sanitized
    })

    const cleanedWorkflowState: WorkflowStateContractInput = {
      ...stateToSave,
      loops: stateToSave.loops || {},
      parallels: stateToSave.parallels || {},
      edges: sanitizedEdges,
      lastSaved: Date.now(),
    }

    await requestJson(putWorkflowNormalizedStateContract, {
      params: { id: workflowId },
      body: cleanedWorkflowState,
    })

    const activeWorkflowId = useWorkflowRegistry.getState().activeWorkflowId
    if (activeWorkflowId === workflowId) {
      useWorkflowStore.setState({ lastSaved: Date.now() })
    }

    return true
  } catch (error) {
    if (error instanceof ApiClientError) {
      logger.error('Failed to persist workflow state after copilot edit', {
        status: error.status,
        message: error.message,
      })
    } else {
      logger.error('Failed to persist workflow state after copilot edit', error)
    }
    return false
  }
}

export async function getLatestUserMessageId(): Promise<string | null> {
  return null
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
