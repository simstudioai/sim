import { resolvePrincipalSubjectUserId } from '@sim/auth/principal'
import type { ListLogsResponse } from '@/lib/api/contracts/logs'
import { defineAuthorizedWorkspaceUseCase, type OperationUseCase } from '@/lib/core/application'
import { asOrchestrationError } from '@/lib/core/orchestration/types'
import {
  isConcealedLogAuthorizationError,
  logDelegationAuthorization,
} from '@/lib/logs/application/authorization'
import { logOperations } from '@/lib/logs/application/operations'
import { type ListLogsParams, readLogs } from '@/lib/logs/list-logs'
import { capabilityDeniedBy } from '@/lib/permission-groups/capability-assertions'
import { resolveActiveWorkspaceApplicationContext } from '@/lib/workspaces/application/workspace-context'
import { getUserPermissionConfig } from '@/ee/access-control/utils/permission-check'

const authorizedListLogsUseCase = defineAuthorizedWorkspaceUseCase({
  operation: logOperations.list,
  resolveContext: ({ input }: { input: ListLogsParams }) =>
    resolveActiveWorkspaceApplicationContext(input.workspaceId),
  authorizationOptions: logDelegationAuthorization(),
  async execute({ principal, input, context }) {
    /**
     * permission-group-enforced: logs.cost — the list carries the same run
     * total the detail does, so withholding it only on the detail would hide
     * nothing. A projection rather than a refusal, for the reason given in
     * `read-log-detail.ts`.
     */
    const viewerUserId = resolvePrincipalSubjectUserId(principal)
    const permissionConfig = viewerUserId
      ? await getUserPermissionConfig(viewerUserId, context.workspaceId)
      : null

    return readLogs({
      ...input,
      workspaceId: context.workspaceId,
      hideCostInfo: capabilityDeniedBy('logs.cost', permissionConfig),
    })
  },
})

export const listLogsUseCase: OperationUseCase<
  typeof logOperations.list,
  ListLogsParams,
  ListLogsResponse
> = {
  operation: logOperations.list,
  async execute(args) {
    try {
      return await authorizedListLogsUseCase.execute(args)
    } catch (error) {
      if (
        isConcealedLogAuthorizationError(error) ||
        asOrchestrationError(error)?.code === 'not_found'
      ) {
        return { data: [], nextCursor: null }
      }
      throw error
    }
  },
}
