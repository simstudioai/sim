import type { Principal } from '@sim/auth/principal'
import {
  type AuthorizingUseCase,
  recordProjectedUseCaseAuditEntries,
  type WorkspaceUseCaseAuditEntry,
} from '@/lib/core/application/authorized-workspace-use-case'
import {
  authorizeOrganizationOperation,
  type OrganizationMembershipContext,
} from '@/lib/core/application/organization-authorization'
import type { OrganizationOperation } from '@/lib/core/application/organization-operation'
import { runWithOutboundOrganization } from '@/lib/core/network/context.server'
import type { OrchestrationRequestContext } from '@/lib/core/orchestration/types'

export interface OrganizationUseCaseContext<I> {
  principal: Principal
  input: I
  context: OrganizationMembershipContext
  request?: OrchestrationRequestContext
}

/** The organization counterpart to the shared workspace authorization and audit lifecycle. */
export function defineAuthorizedOrganizationUseCase<
  const O extends OrganizationOperation,
  I extends { organizationId: string },
  R,
>(definition: {
  operation: O
  authorizeResource?(args: OrganizationUseCaseContext<I>): void | Promise<void>
  execute(args: OrganizationUseCaseContext<I>): Promise<R>
  projectAudit?(
    args: OrganizationUseCaseContext<I> & { result: NoInfer<R> }
  ): WorkspaceUseCaseAuditEntry | WorkspaceUseCaseAuditEntry[]
  afterSuccess?(args: OrganizationUseCaseContext<I> & { result: NoInfer<R> }): void | Promise<void>
}): AuthorizingUseCase<O, I, R> {
  async function authorizePhase(args: {
    principal: Principal
    input: I
    request?: OrchestrationRequestContext
  }): Promise<OrganizationUseCaseContext<I>> {
    const context = await authorizeOrganizationOperation(
      args.principal,
      definition.operation,
      args.input
    )
    const executionContext = { ...args, context }
    await definition.authorizeResource?.(executionContext)
    return executionContext
  }

  return {
    operation: definition.operation,
    async authorize(args) {
      await authorizePhase(args)
    },
    async execute(args) {
      const executionContext = await authorizePhase(args)
      return runWithOutboundOrganization(executionContext.context.organizationId, async () => {
        const result = await definition.execute(executionContext)
        const resultContext = { ...executionContext, result }
        const audit = definition.projectAudit?.(resultContext)
        if (audit !== undefined) {
          recordProjectedUseCaseAuditEntries(
            definition.operation,
            null,
            args.principal,
            args.request,
            Array.isArray(audit) ? audit : [audit],
            executionContext.context.organizationId
          )
        }
        await definition.afterSuccess?.(resultContext)
        return result
      })
    },
  }
}
