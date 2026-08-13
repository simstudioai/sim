import type { Principal } from '@sim/auth/principal'
import { createLogger } from '@sim/logger'
import { OrchestrationError } from '@/lib/core/orchestration/types'
import { defineAuthorizedWorkflowUseCase } from '@/lib/workflows/application/authorized-workflow-use-case'
import { resolveActiveWorkflowApplicationContext } from '@/lib/workflows/application/context'
import { workflowOperations } from '@/lib/workflows/application/operations'
import { assertedWorkflowWorkspaceId } from '@/lib/workflows/application/principal-scope'
import { isDeploymentOperationStatus } from '@/lib/workflows/deployment-lifecycle'
import { listWorkflowVersions as listStoredWorkflowVersions } from '@/lib/workflows/persistence/utils'

const logger = createLogger('ListWorkflowVersions')
const MAX_WORKFLOW_VERSION_PAGE_SIZE = 100
const MAX_UNPAGINATED_WORKFLOW_VERSIONS = 1000

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
    if (
      input.limit !== undefined &&
      (!Number.isInteger(input.limit) ||
        input.limit < 1 ||
        input.limit > MAX_WORKFLOW_VERSION_PAGE_SIZE)
    ) {
      throw new OrchestrationError(
        'validation',
        `Workflow version page size must be between 1 and ${MAX_WORKFLOW_VERSION_PAGE_SIZE}`
      )
    }
    const resultLimit = input.limit ?? MAX_UNPAGINATED_WORKFLOW_VERSIONS
    const { versions } = await listStoredWorkflowVersions(context.workflowId, {
      limit: resultLimit + 1,
      afterVersion: input.afterVersion,
    })
    if (input.limit === undefined && versions.length > MAX_UNPAGINATED_WORKFLOW_VERSIONS) {
      throw new Error(
        `Workflow version list exceeds the ${MAX_UNPAGINATED_WORKFLOW_VERSIONS} row limit`
      )
    }
    const hasMore = input.limit !== undefined && versions.length > resultLimit
    const page = versions.slice(0, resultLimit).map((version) => {
      const latestOperationStatus = version.latestOperationStatus
      if (latestOperationStatus !== null && !isDeploymentOperationStatus(latestOperationStatus)) {
        throw new Error('Deployment version contains an invalid operation status')
      }
      return { ...version, latestOperationStatus }
    })
    logger.info('Listed workflow versions', {
      workspaceId: context.workspaceId,
      workflowId: context.workflowId,
      count: page.length,
      principalKind: principal.kind,
    })
    return { versions: page, hasMore }
  },
})
