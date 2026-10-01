import type { NormalizedWorkflowData } from '@sim/workflow-persistence/types'
import { OrchestrationError } from '@/lib/core/orchestration/types'
import { defineAuthorizedWorkflowUseCase } from '@/lib/workflows/application/authorized-workflow-use-case'
import type { ActiveWorkflowApplicationContext } from '@/lib/workflows/application/context'
import { workflowOperations } from '@/lib/workflows/application/operations'
import { resolvePrincipalWorkflowContext } from '@/lib/workflows/application/principal-scope'
import {
  type DeployedWorkflowData,
  loadDeployedWorkflowState,
  NoActiveDeploymentError,
} from '@/lib/workflows/persistence/utils'
import { loadWorkflowReadSnapshot } from '@/lib/workflows/queries'

export interface ReadWorkflowDefinitionInput {
  workflowId: string
  assertedWorkspaceId?: string
  state: 'draft' | 'deployed'
}

export interface ReadWorkflowDefinitionResult {
  workflow: ActiveWorkflowApplicationContext['workflow']
  workspaceId: string
  state: NormalizedWorkflowData | DeployedWorkflowData | null
}

async function loadDeployedDefinition(workflowId: string, workspaceId: string) {
  try {
    return await loadDeployedWorkflowState(workflowId, workspaceId)
  } catch (error) {
    if (error instanceof NoActiveDeploymentError) return null
    throw error
  }
}

export const readWorkflowDefinition = defineAuthorizedWorkflowUseCase({
  operation: workflowOperations.read,
  resolveContext: resolvePrincipalWorkflowContext<ReadWorkflowDefinitionInput>,
  async execute({ input, context }): Promise<ReadWorkflowDefinitionResult> {
    if (input.state === 'draft') {
      const snapshot = await loadWorkflowReadSnapshot(context.workflowId, context.workspaceId)
      const workflow = snapshot.workflowRecord
      if (!workflow || workflow.archivedAt || workflow.workspaceId !== context.workspaceId) {
        throw new OrchestrationError('not_found', 'Workflow not found')
      }
      return {
        workflow,
        workspaceId: context.workspaceId,
        state: snapshot.normalizedData,
      }
    }

    return {
      workflow: context.workflow,
      workspaceId: context.workspaceId,
      state: await loadDeployedDefinition(context.workflowId, context.workspaceId),
    }
  },
})
