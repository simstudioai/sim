import {
  recordProjectedUseCaseAuditEntries,
  type WorkspaceUseCaseAuditEntry,
} from '@/lib/core/application/authorized-workspace-use-case'
import { ForbiddenOperationError } from '@/lib/core/application/forbidden'
import type { OperationUseCase } from '@/lib/core/application/operation'
import {
  authorizeOrganizationOperation,
  type OrganizationMembershipContext,
} from '@/lib/core/application/organization-authorization'
import type { OrganizationOperation } from '@/lib/core/application/organization-operation'
import { OrchestrationError } from '@/lib/core/orchestration/types'
import {
  PermissionGroupOrganizationNotFoundError,
  rethrowPermissionGroupWriteError,
} from '@/lib/permission-groups/errors'
import { isOrganizationPermissionRegimeActive } from '@/lib/permission-groups/resolve.server'

export interface PermissionGroupOrganizationInput {
  organizationId: string
}
export interface PermissionGroupInput extends PermissionGroupOrganizationInput {
  groupId: string
}

export function defineAuthorizedPermissionGroupUseCase<
  const O extends OrganizationOperation,
  I extends PermissionGroupOrganizationInput,
  R,
>(definition: {
  operation: O
  execute(args: { input: I; context: OrganizationMembershipContext }): Promise<R>
  projectAudit?(args: {
    input: I
    result: NoInfer<R>
  }): WorkspaceUseCaseAuditEntry | WorkspaceUseCaseAuditEntry[]
}): OperationUseCase<O, I, R> {
  return {
    operation: definition.operation,
    async execute({ principal, input, request }) {
      const context = await authorizeOrganizationOperation(
        principal,
        definition.operation,
        input
      ).catch((error: unknown) => {
        if (error instanceof OrchestrationError && error.code === 'not_found')
          throw new PermissionGroupOrganizationNotFoundError()
        if (
          error instanceof OrchestrationError &&
          error.code === 'forbidden' &&
          !(error instanceof ForbiddenOperationError)
        )
          throw new ForbiddenOperationError(
            'ORGANIZATION_ADMIN_REQUIRED',
            'Admin permissions required'
          )
        throw error
      })
      if (!(await isOrganizationPermissionRegimeActive(context.organizationId)))
        throw new ForbiddenOperationError(
          'ENTERPRISE_PLAN_REQUIRED',
          'Access Control is an Enterprise feature'
        )
      const result = await definition
        .execute({ input, context })
        .catch(rethrowPermissionGroupWriteError)
      const audit = definition.projectAudit?.({ input, result })
      if (audit)
        recordProjectedUseCaseAuditEntries(
          definition.operation,
          null,
          principal,
          request,
          Array.isArray(audit) ? audit : [audit],
          context.organizationId
        )
      return result
    },
  }
}
