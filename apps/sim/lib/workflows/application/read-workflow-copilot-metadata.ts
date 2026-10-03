import { mergeSubblockStateWithValues } from '@sim/workflow-persistence/subblocks'
import { OrchestrationError } from '@/lib/core/orchestration/types'
import { defineAuthorizedWorkflowUseCase } from '@/lib/workflows/application/authorized-workflow-use-case'
import { workflowOperations } from '@/lib/workflows/application/operations'
import { resolvePrincipalWorkflowContext } from '@/lib/workflows/application/principal-scope'
import { loadWorkflowFromNormalizedTables } from '@/lib/workflows/persistence/utils'
import { resolveTriggerRunOptions, toPublicRunOption } from '@/lib/workflows/triggers/run-options'

interface CopilotWorkflowQueryInput {
  workflowId: string
  assertedWorkspaceId?: string
}

async function loadDraftWorkflow(workflowId: string) {
  const state = await loadWorkflowFromNormalizedTables(workflowId)
  if (!state) throw new OrchestrationError('not_found', 'Workflow has no saved state')
  return state
}

export interface ReadCopilotWorkflowRunOptionsInput extends CopilotWorkflowQueryInput {}

export const readCopilotWorkflowRunOptions = defineAuthorizedWorkflowUseCase({
  operation: workflowOperations.readCopilotRunOptions,
  resolveContext: resolvePrincipalWorkflowContext<ReadCopilotWorkflowRunOptionsInput>,
  async execute({ context }) {
    const state = await loadDraftWorkflow(context.workflowId)
    const merged = mergeSubblockStateWithValues(state.blocks)
    const options = resolveTriggerRunOptions(merged)
    return {
      options: options.map((option) => toPublicRunOption(option)),
    }
  },
})
