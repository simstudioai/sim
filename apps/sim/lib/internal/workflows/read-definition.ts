import type { BoundWorkflowExecutionPrincipal } from '@sim/auth/principal'
import { bindRuntimeWorkflowExecutionPrincipal } from '@/lib/auth/internal-delegation'
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
  const runtimePrincipal = await bindRuntimeWorkflowExecutionPrincipal(principal)
  return readWorkflowDefinition.execute({
    principal: runtimePrincipal,
    input: { workflowId, state },
  })
}
