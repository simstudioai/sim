import type { Principal } from '@sim/auth/principal'
import {
  recordProjectedUseCaseAuditEntries,
  type WorkspaceUseCaseAuditEntry,
} from '@/lib/core/application/authorized-workspace-use-case'
import type { OperationUseCase } from '@/lib/core/application/operation'
import {
  authorizeOrganizationOperation,
  type OrganizationMembershipContext,
} from '@/lib/core/application/organization-authorization'
import type { OrganizationOperation } from '@/lib/core/application/organization-operation'
import {
  asOrchestrationError,
  OrchestrationError,
  type OrchestrationRequestContext,
} from '@/lib/core/orchestration/types'

interface ConfigurationExecution<I> {
  principal: Principal
  input: I
  request?: OrchestrationRequestContext
  context: OrganizationMembershipContext
}

interface ConfigurationDefinition<O extends OrganizationOperation, I, R> {
  operation: O
  administratorError?: string
  execute(args: ConfigurationExecution<I>): Promise<R>
  projectAudit?(
    args: ConfigurationExecution<I> & { result: R }
  ): WorkspaceUseCaseAuditEntry | undefined
}

/** Shares current organization authorization and semantic audit across configuration surfaces. */
export function defineOrganizationConfigurationUseCase<
  const O extends OrganizationOperation,
  I extends { organizationId: string },
  R,
>(definition: ConfigurationDefinition<O, I, R>): OperationUseCase<O, I, R> {
  return {
    operation: definition.operation,
    delegationAudience: definition.operation.delegationAudience,
    async execute(args) {
      let context: OrganizationMembershipContext
      try {
        context = await authorizeOrganizationOperation(
          args.principal,
          definition.operation,
          args.input
        )
      } catch (error) {
        const classified = asOrchestrationError(error)
        if (classified?.code === 'not_found') {
          throw new OrchestrationError('forbidden', 'Forbidden - Not a member of this organization')
        }
        if (
          args.principal.kind === 'session' &&
          classified?.code === 'forbidden' &&
          definition.administratorError
        ) {
          throw new OrchestrationError('forbidden', definition.administratorError)
        }
        throw error
      }
      const result = await definition.execute({ ...args, context })
      const audit = definition.projectAudit?.({ ...args, context, result })
      if (audit) {
        recordProjectedUseCaseAuditEntries(
          definition.operation,
          null,
          args.principal,
          args.request,
          [audit],
          args.input.organizationId
        )
      }
      return result
    },
  }
}
