import type { Principal } from '@sim/auth/principal'
import { createLogger } from '@sim/logger'
import { defineAuthorizedWorkflowUseCase } from '@/lib/workflows/application/authorized-workflow-use-case'
import { resolveActiveWorkflowApplicationContext } from '@/lib/workflows/application/context'
import { workflowOperations } from '@/lib/workflows/application/operations'
import { assertedWorkflowWorkspaceId } from '@/lib/workflows/application/principal-scope'
import { listWorkflowVersions as listStoredWorkflowVersions } from '@/lib/workflows/persistence/utils'

const logger = createLogger('ListWorkflowVersions')

export interface ListWorkflowVersionsInput {
  workflowId: string
  assertedWorkspaceId?: string
  limit?: number
  afterVersion?: number
}

export const listWorkflowVersions = defineAuthorizedWorkflowUseCase({
  operation: workflowOperations.listVersions,
  resolveContext: ({
    principal,
    input,
  }: {
    principal: Principal
    input: ListWorkflowVersionsInput
  }) =>
    resolveActiveWorkflowApplicationContext({
      workflowId: input.workflowId,
      assertedWorkspaceId: assertedWorkflowWorkspaceId(principal, input.assertedWorkspaceId),
    }),
  async execute({ principal, input, context }) {
    const { versions } = await listStoredWorkflowVersions(context.workflowId, {
      limit: input.limit === undefined ? undefined : input.limit + 1,
      afterVersion: input.afterVersion,
    })
    const hasMore = input.limit !== undefined && versions.length > input.limit
    const page = input.limit === undefined ? versions : versions.slice(0, input.limit)
    logger.info('Listed workflow versions', {
      workspaceId: context.workspaceId,
      workflowId: context.workflowId,
      count: page.length,
      principalKind: principal.kind,
    })
    return { versions: page, hasMore }
  },
})
