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
import type { DbClient, DbOrTx, DbTransaction } from '@/lib/db/types'
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

/** A mutation executes inside the funnel's transaction; a read runs on the pool-level client. */
interface AccessRequestUseCaseArgs<I, E extends DbOrTx = DbOrTx>
  extends AccessRequestPreparationArgs<I> {
  executor: E
}

interface AccessRequestUseCaseDefinition<I, R> {
  operation: AccessRequestOperation
  scope(input: I): AccessRequestScope
  projectAudit?(args: AccessRequestUseCaseArgs<I> & { result: R }): WorkspaceUseCaseAuditEntry[]
}

interface PreparedAccessRequestUseCase<I, R, P, E extends DbOrTx>
  extends AccessRequestUseCaseDefinition<I, R> {
  prepare(args: AccessRequestPreparationArgs<I>): Promise<P>
  execute(args: AccessRequestUseCaseArgs<I, E> & { prepared: P }): Promise<R>
}

interface UnpreparedAccessRequestUseCase<I, R, E extends DbOrTx>
  extends AccessRequestUseCaseDefinition<I, R> {
  prepare?: never
  execute(args: AccessRequestUseCaseArgs<I, E> & { prepared: undefined }): Promise<R>
}

type AccessRequestUseCase<I, R, P, E extends DbOrTx> =
  | PreparedAccessRequestUseCase<I, R, P, E>
  | UnpreparedAccessRequestUseCase<I, R, E>

type MutationAccessRequestUseCase<I, R, P> = AccessRequestUseCase<I, R, P, DbTransaction> & {
  mutation: true
}

type ReadAccessRequestUseCase<I, R, P> = AccessRequestUseCase<I, R, P, DbClient> & {
  mutation?: false
}

function requireAccessRequestPrincipal(
  principal: Principal,
  operation: AccessRequestOperation
): asserts principal is AccessRequestPrincipal {
  requireAllowedWorkspacePrincipal(principal, operation)
}

/** Runs preparation before any transaction opens and binds its result to `execute`. */
async function prepareExecution<I, R, P, E extends DbOrTx>(
  definition: AccessRequestUseCase<I, R, P, E>,
  args: AccessRequestPreparationArgs<I>
): Promise<(args: AccessRequestUseCaseArgs<I, E>) => Promise<R>> {
  if (definition.prepare) {
    const prepared = await definition.prepare(args)
    const executePrepared = definition.execute
    return (executeArgs) => executePrepared({ ...executeArgs, prepared })
  }
  const executeUnprepared = definition.execute
  return (executeArgs) => executeUnprepared({ ...executeArgs, prepared: undefined })
}

export function defineAuthorizedAccessRequestUseCase<I, R, P>(
  definition:
    | (PreparedAccessRequestUseCase<I, R, P, DbTransaction> & { mutation: true })
    | (PreparedAccessRequestUseCase<I, R, P, DbClient> & { mutation?: false })
): OperationUseCase<AccessRequestOperation, I, R>
export function defineAuthorizedAccessRequestUseCase<I, R>(
  definition:
    | (UnpreparedAccessRequestUseCase<I, R, DbTransaction> & { mutation: true })
    | (UnpreparedAccessRequestUseCase<I, R, DbClient> & { mutation?: false })
): OperationUseCase<AccessRequestOperation, I, R>
/** Shared human-credential funnel; preparation finishes before any transaction acquires locks. */
export function defineAuthorizedAccessRequestUseCase<I, R, P = undefined>(
  definition: MutationAccessRequestUseCase<I, R, P> | ReadAccessRequestUseCase<I, R, P>
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
        const preparation = { principal, input, context: initial }
        let context = initial
        let result: R
        if (definition.mutation) {
          const execute = await prepareExecution(definition, preparation)
          result = await db.transaction(async (executor) => {
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
        } else {
          const execute = await prepareExecution(definition, preparation)
          result = await execute({ principal, input, context, executor: db })
        }
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
