import { createLogger } from '@sim/logger'
import { useVariablesStore } from '@/stores/variables/store'
import type { Variable } from '@/stores/variables/types'
import { useSubBlockStore } from '@/stores/workflows/subblock/store'
import { useWorkflowStore } from '@/stores/workflows/workflow/store'
import type { WorkflowState } from '@/stores/workflows/workflow/types'

const logger = createLogger('ApplyWorkflowState')

function cloneWorkflowState(state: WorkflowState): WorkflowState {
  return {
    ...state,
    blocks: structuredClone(state.blocks || {}),
    edges: structuredClone(state.edges || []),
    loops: structuredClone(state.loops || {}),
    parallels: structuredClone(state.parallels || {}),
  }
}

function extractSubBlockValues(
  workflowState: WorkflowState
): Record<string, Record<string, unknown>> {
  const values: Record<string, Record<string, unknown>> = {}
  Object.entries(workflowState.blocks || {}).forEach(([blockId, block]) => {
    values[blockId] = {}
    Object.entries(block.subBlocks || {}).forEach(([subBlockId, subBlock]) => {
      values[blockId][subBlockId] = subBlock?.value ?? null
    })
  })
  return values
}

/**
 * Replaces the workflow, sub-block and (when present) variable stores with a server-of-record
 * workflow state.
 */
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
  if (Object.hasOwn(workflowState, 'variables')) {
    applyWorkflowVariablesToStore(workflowId, workflowState.variables)
  }

  const afterState = workflowStore.getWorkflowState()
  logger.info('[applyWorkflowStateToStores] Applied workflow state to stores', {
    workflowId,
    afterEdgeCount: afterState.edges?.length ?? 0,
  })
}

export function applyWorkflowVariablesToStore(
  workflowId: string,
  variables?: WorkflowState['variables'] | null
) {
  const stampedVariables: Record<string, Variable> = {}

  Object.entries(variables || {}).forEach(([id, variable]) => {
    if (!variable?.name) return
    stampedVariables[id] = {
      id: variable.id || id,
      workflowId,
      name: variable.name,
      type: variable.type || 'plain',
      value: Object.hasOwn(variable, 'value') ? variable.value : '',
    }
  })

  useVariablesStore.setState((state) => ({
    variables: {
      ...Object.fromEntries(
        Object.entries(state.variables).filter(([, variable]) => variable.workflowId !== workflowId)
      ),
      ...stampedVariables,
    },
  }))
}
