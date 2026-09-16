import type { Principal } from '@sim/auth/principal'
import {
  recordProjectedUseCaseAuditEntries,
  type WorkspaceUseCaseAuditEntry,
} from '@/lib/core/application/authorized-workspace-use-case'
import type { OperationUseCase } from '@/lib/core/application/operation'
import { authorizeOrganizationOperation } from '@/lib/core/application/organization-authorization'
import {
  asOrchestrationError,
  OrchestrationError,
  type OrchestrationRequestContext,
} from '@/lib/core/orchestration/types'
import { classifyPermissionGroupError } from '@/lib/permission-groups/application/management-errors'
import type { PermissionGroupManagementOperation } from '@/lib/permission-groups/application/management-operations'
import { loadGroupInOrganization } from '@/lib/permission-groups/application/management-store'
import { isOrganizationPermissionRegimeActive } from '@/lib/permission-groups/resolve.server'

export interface PermissionGroupScope {
  organizationId: string
  groupId?: string
}

/** Preserves pre-parse authorization without giving the HTTP adapter protected data access. */
export async function authorizePermissionGroupManagement(
  principal: Principal,
  operation: PermissionGroupManagementOperation,
  input: PermissionGroupScope
) {
  try {
    await authorizeOrganizationOperation(principal, operation, input)
  } catch (error) {
    const classified = asOrchestrationError(error)
    if (
      classified?.code === 'not_found' ||
      (principal.kind === 'session' && classified?.code === 'forbidden')
    ) {
      throw new OrchestrationError('forbidden', 'Admin permissions required')
    }
    throw error
  }
  if (!(await isOrganizationPermissionRegimeActive(input.organizationId))) {
    throw new OrchestrationError('forbidden', 'Access Control is an Enterprise feature')
  }
  if (
    input.groupId !== undefined &&
    !(await loadGroupInOrganization(input.groupId, input.organizationId))
  ) {
    throw new OrchestrationError('not_found', 'Permission group not found')
  }
}

interface ManagementExecution<I> {
  principal: Principal
  input: I
  request?: OrchestrationRequestContext
}

/** Keeps semantic audits and current authorization common to HTTP and Assistant management. */
export function definePermissionGroupManagementUseCase<
  const O extends PermissionGroupManagementOperation,
  I extends PermissionGroupScope,
  R,
>(definition: {
  operation: O
  execute(args: ManagementExecution<I>): Promise<R>
  projectAudit?(args: ManagementExecution<I> & { result: R }): WorkspaceUseCaseAuditEntry | null
}): OperationUseCase<O, I, R> {
  return {
    operation: definition.operation,
    delegationAudience: definition.operation.delegationAudience,
    async authorize({ principal, input }) {
      await authorizePermissionGroupManagement(principal, definition.operation, input)
    },
    async execute(args) {
      await authorizePermissionGroupManagement(args.principal, definition.operation, args.input)
      let result: R
      try {
        result = await definition.execute(args)
      } catch (error) {
        throw classifyPermissionGroupError(error, definition.operation.id) ?? error
      }
      const audit = definition.projectAudit?.({ ...args, result })
      if (audit)
        recordProjectedUseCaseAuditEntries(
          definition.operation,
          null,
          args.principal,
          args.request,
          [audit],
          args.input.organizationId
        )
      return result
    },
  }
}
