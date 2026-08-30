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
import { assertLogCostQueryAllowed } from '@/lib/logs/log-projection'
import { capabilityDeniedBy } from '@/lib/permission-groups/capability-assertions'
import { resolvePermissionGroupConfig } from '@/lib/permission-groups/config-scope.server'
import { resolveActiveWorkspaceApplicationContext } from '@/lib/workspaces/application/workspace-context'

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
      ? await resolvePermissionGroupConfig(
          viewerUserId,
          context.workspaceId,
          context.workspaceOrganizationId
        )
      : null

    const hideCostInfo = capabilityDeniedBy('logs.cost', permissionConfig)
    /**
     * The list's own `sortBy=cost` and `costOperator`/`costValue` select on the
     * very figure the row above blanks, so they have to be refused rather than
     * answered — see {@link assertLogCostQueryAllowed}.
     */
    assertLogCostQueryAllowed(input, { hideCostInfo })

    return readLogs({
      ...input,
      workspaceId: context.workspaceId,
      hideCostInfo,
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
