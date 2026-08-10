import type { Principal } from '@sim/auth/principal'
import type { NormalizedWorkflowData } from '@sim/workflow-persistence/types'
import { defineAuthorizedWorkflowUseCase } from '@/lib/workflows/application/authorized-workflow-use-case'
import { resolveActiveWorkflowApplicationContext } from '@/lib/workflows/application/context'
import { workflowOperations } from '@/lib/workflows/application/operations'
import { assertedWorkflowWorkspaceId } from '@/lib/workflows/application/principal-scope'
import {
  type DeployedWorkflowData,
  loadDeployedWorkflowState,
  loadWorkflowFromNormalizedTables,
  NoActiveDeploymentError,
} from '@/lib/workflows/persistence/utils'

export interface ReadWorkflowDefinitionInput {
  workflowId: string
  assertedWorkspaceId?: string
  state: 'draft' | 'deployed'
}

export interface ReadWorkflowDefinitionResult {
  workflow: Awaited<ReturnType<typeof resolveActiveWorkflowApplicationContext>>['workflow']
  workspaceId: string
  state: NormalizedWorkflowData | DeployedWorkflowData | null
}

async function loadDefinition(input: ReadWorkflowDefinitionInput, workspaceId: string) {
  if (input.state === 'draft') return loadWorkflowFromNormalizedTables(input.workflowId)
  try {
    return await loadDeployedWorkflowState(input.workflowId, workspaceId)
  } catch (error) {
    if (error instanceof NoActiveDeploymentError) return null
    throw error
  }
}

export const readWorkflowDefinition = defineAuthorizedWorkflowUseCase({
  operation: workflowOperations.read,
  resolveContext: ({
    principal,
    input,
  }: {
    principal: Principal
    input: ReadWorkflowDefinitionInput
  }) =>
    resolveActiveWorkflowApplicationContext({
      workflowId: input.workflowId,
      assertedWorkspaceId: assertedWorkflowWorkspaceId(principal, input.assertedWorkspaceId),
    }),
  async execute({ input, context }): Promise<ReadWorkflowDefinitionResult> {
    return {
      workflow: context.workflow,
      workspaceId: context.workspaceId,
      state: await loadDefinition(input, context.workspaceId),
    }
  },
})
