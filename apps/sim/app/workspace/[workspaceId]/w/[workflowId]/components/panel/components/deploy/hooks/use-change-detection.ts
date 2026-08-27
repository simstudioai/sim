import { useMemo } from 'react'
import { mergeSubblockStateWithValues } from '@sim/workflow-persistence/subblocks'
import { generateWorkflowDiffSummary } from '@/lib/workflows/comparison'
import { useVariablesStore } from '@/stores/variables/store'
import { useSubBlockStore } from '@/stores/workflows/subblock/store'
import { useWorkflowStore } from '@/stores/workflows/workflow/store'
import type { WorkflowState } from '@/stores/workflows/workflow/types'

/** Stable identity so an unchanged workflow does not hand consumers a fresh array. */
const EMPTY_FIELDS: string[] = []

interface UseChangeDetectionProps {
  workflowId: string | null
  deployedState: WorkflowState | null
  isLoadingDeployedState: boolean
}

interface UseChangeDetectionResult {
  changeDetected: boolean
  /**
   * The field names behind `changeDetected`, for diagnostics only — never for
   * rendering. Free: `hasWorkflowChanged` is `generateWorkflowDiffSummary(…).hasChanges`,
   * so the summary is computed either way and throwing it away only hid which
   * fields drove a redeploy prompt.
   */
  changedFields: string[]
  isChangeDetectionSettling: boolean
}

/**
 * Detects meaningful changes between current workflow state and deployed state.
 * Performs comparison entirely on the client using generateWorkflowDiffSummary —
 * no API calls needed. The deployed state snapshot is fetched once via React Query
 * and refreshed after deploy/undeploy/version-activate mutations.
 */
export function useChangeDetection({
  workflowId,
  deployedState,
  isLoadingDeployedState,
}: UseChangeDetectionProps): UseChangeDetectionResult {
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

  const { changeDetected, changedFields } = useMemo(() => {
    if (!currentState || !deployedState || isLoadingDeployedState) {
      return { changeDetected: false, changedFields: EMPTY_FIELDS }
    }

    const summary = generateWorkflowDiffSummary(currentState, deployedState)
    if (!summary.hasChanges) {
      return { changeDetected: false, changedFields: EMPTY_FIELDS }
    }

    const fields = new Set<string>()
    for (const block of summary.modifiedBlocks) {
      for (const change of block.changes) {
        fields.add(`${block.type}.${change.field}`)
      }
    }
    for (const block of summary.addedBlocks) fields.add(`+block:${block.type}`)
    for (const block of summary.removedBlocks) fields.add(`-block:${block.type}`)
    if (summary.edgeChanges.added > 0 || summary.edgeChanges.removed > 0) fields.add('edges')
    if (summary.loopChanges.modified > 0) fields.add('loops')
    if (summary.parallelChanges.modified > 0) fields.add('parallels')
    if (summary.variableChanges.modified > 0) fields.add('variables')

    return { changeDetected: true, changedFields: [...fields] }
  }, [currentState, deployedState, isLoadingDeployedState])

  return {
    changeDetected,
    changedFields,
    isChangeDetectionSettling: Boolean(workflowId && isLoadingDeployedState),
  }
}
