import type { BoundWorkflowExecutionPrincipal } from '@sim/auth/principal'
import { bindRuntimeWorkflowExecution } from '@/lib/auth/internal-delegation'
import {
  type ReadWorkflowDefinitionInput,
  readWorkflowDefinition,
} from '@/lib/workflows/application/read-workflow-definition'

export interface ReadWorkflowDefinitionAsExecutorInput {
  principal: BoundWorkflowExecutionPrincipal
  workflowId: string
  state: ReadWorkflowDefinitionInput['state']
}

export async function readWorkflowDefinitionAsExecutor({
  principal,
  workflowId,
  state,
}: ReadWorkflowDefinitionAsExecutorInput) {
  const runtime = await bindRuntimeWorkflowExecution(principal)
  return readWorkflowDefinition.execute({
    principal: runtime.principal,
    input: { workflowId, state, assertedWorkspaceId: runtime.workspaceId },
  })
}
