import { useMemo } from 'react'
import { mergeSubblockStateWithValues } from '@sim/workflow-persistence/subblocks'
import { useVariablesStore } from '@/stores/variables/store'
import { useSubBlockStore } from '@/stores/workflows/subblock/store'
import { useWorkflowStore } from '@/stores/workflows/workflow/store'
import type { WorkflowState } from '@/stores/workflows/workflow/types'

/**
 * The live draft as one workflow state: canvas blocks merged with the
 * sub-block values the editor holds separately, plus this workflow's
 * variables. This is the shape deployment snapshots use, so it compares
 * cleanly against any of them.
 *
 * The merge walks every block on every store change, so a consumer that has
 * nothing to compare against yet passes `false` as `enabled` and gets null
 * without paying for it.
 */
export function useDraftWorkflowState(
  workflowId: string | null,
  enabled = true
): WorkflowState | null {
  const active = enabled && Boolean(workflowId)
  const blocks = useWorkflowStore((state) => (active ? state.blocks : null))
  const edges = useWorkflowStore((state) => (active ? state.edges : null))
  const loops = useWorkflowStore((state) => (active ? state.loops : null))
  const parallels = useWorkflowStore((state) => (active ? state.parallels : null))
  const subBlockValues = useSubBlockStore((state) =>
    active && workflowId ? state.workflowValues[workflowId] : null
  )
  const allVariables = useVariablesStore((state) => (active ? state.variables : null))

  const workflowVariables = useMemo(() => {
    const vars: WorkflowState['variables'] = {}
    if (!workflowId || !allVariables) return vars
    for (const [id, variable] of Object.entries(allVariables)) {
      if (variable.workflowId === workflowId) vars[id] = variable
    }
    return vars
  }, [workflowId, allVariables])

  return useMemo((): WorkflowState | null => {
    if (!workflowId || !blocks || !edges || !loops || !parallels) return null
    return {
      blocks: mergeSubblockStateWithValues(blocks, subBlockValues ?? {}),
      edges,
      loops,
      parallels,
      variables: workflowVariables,
    }
  }, [workflowId, blocks, edges, loops, parallels, subBlockValues, workflowVariables])
}
