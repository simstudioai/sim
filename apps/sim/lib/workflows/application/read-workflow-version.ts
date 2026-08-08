import type { Principal } from '@sim/auth/principal'
import { createLogger } from '@sim/logger'
import { OrchestrationError } from '@/lib/core/orchestration/types'
import { defineAuthorizedWorkflowUseCase } from '@/lib/workflows/application/authorized-workflow-use-case'
import { resolveActiveWorkflowApplicationContext } from '@/lib/workflows/application/context'
import { workflowOperations } from '@/lib/workflows/application/operations'
import { assertedWorkflowWorkspaceId } from '@/lib/workflows/application/principal-scope'
import { getWorkflowDeploymentVersion } from '@/lib/workflows/persistence/utils'

const logger = createLogger('ReadWorkflowVersion')

export interface ReadWorkflowVersionInput {
  workflowId: string
  assertedWorkspaceId?: string
  version: number
}

export const readWorkflowVersion = defineAuthorizedWorkflowUseCase({
  operation: workflowOperations.readVersion,
  resolveContext: ({
    principal,
    input,
  }: {
    principal: Principal
    input: ReadWorkflowVersionInput
  }) =>
    resolveActiveWorkflowApplicationContext({
      workflowId: input.workflowId,
      assertedWorkspaceId: assertedWorkflowWorkspaceId(principal, input.assertedWorkspaceId),
    }),
  async execute({ principal, input, context }) {
    const version = await getWorkflowDeploymentVersion(context.workflowId, input.version)
    if (!version?.state) {
      throw new OrchestrationError('not_found', 'Deployment version not found')
    }
    logger.info('Read workflow version', {
      workspaceId: context.workspaceId,
      workflowId: context.workflowId,
      version: input.version,
      principalKind: principal.kind,
    })
    return { version }
  },
})
