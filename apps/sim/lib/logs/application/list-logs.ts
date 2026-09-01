import type { ListLogsResponse } from '@/lib/api/contracts/logs'
import { defineAuthorizedWorkspaceUseCase, type OperationUseCase } from '@/lib/core/application'
import { asOrchestrationError } from '@/lib/core/orchestration/types'
import {
  isConcealedLogAuthorizationError,
  logDelegationAuthorization,
} from '@/lib/logs/application/authorization'
import { logOperations } from '@/lib/logs/application/operations'
import { type ListLogsParams, readLogs } from '@/lib/logs/list-logs'
import { resolveActiveWorkspaceApplicationContext } from '@/lib/workspaces/application/workspace-context'

const authorizedListLogsUseCase = defineAuthorizedWorkspaceUseCase({
  operation: logOperations.list,
  resolveContext: ({ input }: { input: ListLogsParams }) =>
    resolveActiveWorkspaceApplicationContext(input.workspaceId),
  authorizationOptions: logDelegationAuthorization(),
  async execute({ input, context }) {
    return readLogs({ ...input, workspaceId: context.workspaceId })
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
