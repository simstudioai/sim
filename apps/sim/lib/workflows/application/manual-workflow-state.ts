import { OrchestrationError } from '@/lib/core/orchestration/types'
import { getExecutionStateForWorkflow } from '@/lib/workflows/executor/execution-state'
import { loadWorkflowFromNormalizedTables } from '@/lib/workflows/persistence/utils'

/** Loads the saved draft after the caller has authorized the manual operation. */
export async function loadManualWorkflowState(
  workflowId: string,
  options: { persistMigrations?: boolean } = {}
) {
  const state = await loadWorkflowFromNormalizedTables(workflowId, undefined, options)
  if (!state) {
    throw new OrchestrationError(
      'validation',
      `Workflow ${workflowId} has no saved state to run manually.`
    )
  }
  return state
}

/** Binds a manual entry point and its cached state to the authorized workflow. */
export async function loadManualWorkflowFromBlockState(
  input: { workflowId: string; blockId: string; sourceRunId: string },
  options: { persistMigrations?: boolean } = {}
) {
  const state = await loadManualWorkflowState(input.workflowId, options)
  if (!Object.hasOwn(state.blocks, input.blockId)) {
    throw new OrchestrationError(
      'validation',
      `run.entry.blockId "${input.blockId}" is not a block in the current saved workflow.`
    )
  }
  const sourceSnapshot = await getExecutionStateForWorkflow(input.sourceRunId, input.workflowId)
  if (!sourceSnapshot) {
    throw new OrchestrationError(
      'not_found',
      `No execution state found for source run "${input.sourceRunId}" in this workflow.`
    )
  }
  return { state, sourceSnapshot }
}
