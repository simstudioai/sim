import { useMemo } from 'react'
import { hasWorkflowChanged } from '@/lib/workflows/comparison'
import { mergeSubblockStateWithValues } from '@/lib/workflows/subblocks'
import { useVariablesStore } from '@/stores/variables/store'
import { useSubBlockStore } from '@/stores/workflows/subblock/store'
import { useWorkflowStore } from '@/stores/workflows/workflow/store'
import type { WorkflowState } from '@/stores/workflows/workflow/types'

interface UseChangeDetectionProps {
  workflowId: string | null
  deployedState: WorkflowState | null
  isLoadingDeployedState: boolean
}

/**
 * Detects meaningful changes between current workflow state and deployed state.
 * Performs comparison entirely on the client using hasWorkflowChanged — no API
 * calls needed. The deployed state snapshot is fetched once via React Query and
 * refreshed after deploy/undeploy/version-activate mutations.
 */
export function useChangeDetection({
  workflowId,
  deployedState,
  isLoadingDeployedState,
}: UseChangeDetectionProps) {
  const blocks = useWorkflowStore((state) => state.blocks)
  const edges = useWorkflowStore((state) => state.edges)
  const loops = useWorkflowStore((state) => state.loops)
  const parallels = useWorkflowStore((state) => state.parallels)
  const subBlockValues = useSubBlockStore((state) =>
    workflowId ? state.workflowValues[workflowId] : null
  )
  const allVariables = useVariablesStore((state) => state.variables)
  const workflowVariables = useMemo(() => {
    if (!workflowId) return {}
    const vars: Record<string, any> = {}
    for (const [id, variable] of Object.entries(allVariables)) {
      if (variable.workflowId === workflowId) {
        vars[id] = variable
      }
    }
    return vars
  }, [workflowId, allVariables])

  const currentState = useMemo((): WorkflowState | null => {
    if (!workflowId || !deployedState) return null

    const mergedBlocks = mergeSubblockStateWithValues(blocks, subBlockValues ?? {})

    return {
      blocks: mergedBlocks,
      edges,
      loops,
      parallels,
      variables: workflowVariables,
    } as WorkflowState & { variables: Record<string, any> }
  }, [
    workflowId,
    deployedState,
    blocks,
    edges,
    loops,
    parallels,
    subBlockValues,
    workflowVariables,
  ])

  const changeDetected = useMemo(() => {
    if (!currentState || !deployedState || isLoadingDeployedState) return false
    return hasWorkflowChanged(currentState, deployedState)
  }, [currentState, deployedState, isLoadingDeployedState])

  return { changeDetected }
}
