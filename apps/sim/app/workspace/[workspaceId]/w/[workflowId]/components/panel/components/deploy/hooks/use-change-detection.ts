import { useMemo } from 'react'
import { generateWorkflowDiffSummary } from '@/lib/workflows/comparison'
import { useDraftWorkflowState } from '@/app/workspace/[workspaceId]/w/[workflowId]/components/panel/components/deploy/hooks/use-draft-workflow-state'
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
  /* Nothing to compare against until the deployed state is in hand, so skip the merge until then. */
  const currentState = useDraftWorkflowState(workflowId, Boolean(deployedState))

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
