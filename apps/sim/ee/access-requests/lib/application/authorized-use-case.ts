import type { Principal } from '@sim/auth/principal'
import { db } from '@sim/db'
import { acquireOrganizationMutationLock } from '@/lib/billing/organizations/membership'
import {
  recordProjectedUseCaseAuditEntries,
  type WorkspaceUseCaseAuditEntry,
} from '@/lib/core/application/authorized-workspace-use-case'
import type { OperationUseCase } from '@/lib/core/application/operation'
import { requireAllowedWorkspacePrincipal } from '@/lib/core/application/workspace-authorization'
import { runWithOutboundOrganization } from '@/lib/core/network/context.server'
import type { DbOrTx } from '@/lib/db/types'
import {
  type AccessRequestContext,
  authorizeAccessRequestScope,
} from '@/ee/access-requests/lib/application/authorization'
import type {
  AccessRequestOperation,
  AccessRequestPrincipal,
} from '@/ee/access-requests/lib/application/operations'
import type { AccessRequestScope } from '@/ee/access-requests/lib/targets'

interface AccessRequestPreparationArgs<I> {
  principal: AccessRequestPrincipal
  input: I
  context: AccessRequestContext
}

interface AccessRequestUseCaseArgs<I> extends AccessRequestPreparationArgs<I> {
  executor: DbOrTx
}

interface AccessRequestUseCaseDefinition<I, R> {
  operation: AccessRequestOperation
  scope(input: I): AccessRequestScope
  mutation?: boolean
  projectAudit?(args: AccessRequestUseCaseArgs<I> & { result: R }): WorkspaceUseCaseAuditEntry[]
}

interface PreparedAccessRequestUseCase<I, R, P> extends AccessRequestUseCaseDefinition<I, R> {
  prepare(args: AccessRequestPreparationArgs<I>): Promise<P>
  execute(args: AccessRequestUseCaseArgs<I> & { prepared: P }): Promise<R>
}

interface UnpreparedAccessRequestUseCase<I, R> extends AccessRequestUseCaseDefinition<I, R> {
  prepare?: never
  execute(args: AccessRequestUseCaseArgs<I> & { prepared: undefined }): Promise<R>
}

function requireAccessRequestPrincipal(
  principal: Principal,
  operation: AccessRequestOperation
): asserts principal is AccessRequestPrincipal {
  requireAllowedWorkspacePrincipal(principal, operation)
}

export function defineAuthorizedAccessRequestUseCase<I, R, P>(
  definition: PreparedAccessRequestUseCase<I, R, P>
): OperationUseCase<AccessRequestOperation, I, R>
export function defineAuthorizedAccessRequestUseCase<I, R>(
  definition: UnpreparedAccessRequestUseCase<I, R>
): OperationUseCase<AccessRequestOperation, I, R>
/** Shared human-credential funnel; preparation finishes before any transaction acquires locks. */
export function defineAuthorizedAccessRequestUseCase<I, R, P = undefined>(
  definition: PreparedAccessRequestUseCase<I, R, P> | UnpreparedAccessRequestUseCase<I, R>
): OperationUseCase<AccessRequestOperation, I, R> {
  return {
    operation: definition.operation,
    async authorize({ principal, input }) {
      requireAccessRequestPrincipal(principal, definition.operation)
      await authorizeAccessRequestScope(principal, definition.operation, definition.scope(input))
    },
    async execute({ principal, input, request }) {
      requireAccessRequestPrincipal(principal, definition.operation)
      const scope = definition.scope(input)
      const initial = await authorizeAccessRequestScope(principal, definition.operation, scope)
      return runWithOutboundOrganization(initial.organizationId, async () => {
        let execute: (args: AccessRequestUseCaseArgs<I>) => Promise<R>
        if (definition.prepare) {
          const prepared = await definition.prepare({ principal, input, context: initial })
          const executePrepared = definition.execute
          execute = (args) => executePrepared({ ...args, prepared })
        } else {
          const executeUnprepared = definition.execute
          execute = (args) => executeUnprepared({ ...args, prepared: undefined })
        }
        let context = initial
        const result = definition.mutation
          ? await db.transaction(async (executor) => {
              if (initial.organizationId) {
                await acquireOrganizationMutationLock(executor, initial.organizationId)
              }
              context = await authorizeAccessRequestScope(
                principal,
                definition.operation,
                scope,
                executor,
                true,
                initial
              )
              return execute({ principal, input, context, executor })
            })
          : await execute({ principal, input, context, executor: db })
        if (definition.projectAudit) {
          recordProjectedUseCaseAuditEntries(
            definition.operation,
            context.workspaceId,
            principal,
            request,
            definition.projectAudit({ principal, input, context, executor: db, result }),
            context.organizationId ?? undefined
          )
        }
        return result
      })
    },
  }
}
