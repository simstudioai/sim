import type { Principal } from '@sim/auth/principal'
import { db } from '@sim/db'
import {
  type AuthorizingUseCase,
  recordProjectedUseCaseAuditEntries,
  type WorkspaceUseCaseAuditEntry,
} from '@/lib/core/application/authorized-workspace-use-case'
import { runWithOutboundOrganization } from '@/lib/core/network/context.server'
import type { OrchestrationRequestContext } from '@/lib/core/orchestration/types'
import type { DbTransaction } from '@/lib/db/types'
import {
  createProjectFileAuthorizer,
  type ProjectFileAuthorizationContext,
  type ProjectFileTarget,
} from '@/lib/projects/files/application/authorization'
import type { ProjectFileOperation } from '@/lib/projects/files/application/operations'
import { notifyFileListChanged } from '@/lib/realtime/notify'

interface ProjectFileUseCaseContext<I> {
  principal: Principal
  input: I
  context: ProjectFileAuthorizationContext
  request?: OrchestrationRequestContext
}

/** Project file operations authorize and mutate under the same canonical Project transaction. */
export function defineAuthorizedProjectFileUseCase<
  const O extends ProjectFileOperation,
  I extends ProjectFileTarget,
  R,
  P = undefined,
>(definition: {
  operation: O
  prepare?(args: ProjectFileUseCaseContext<I>): Promise<P>
  execute(args: ProjectFileUseCaseContext<I> & { tx: DbTransaction; prepared?: P }): Promise<R>
  onCommitFailure?(
    args: ProjectFileUseCaseContext<I> & { prepared: P; error: unknown }
  ): Promise<void>
  projectAudit?(
    args: ProjectFileUseCaseContext<I> & { result: NoInfer<R> }
  ): WorkspaceUseCaseAuditEntry | WorkspaceUseCaseAuditEntry[]
  afterSuccess?(args: ProjectFileUseCaseContext<I> & { result: NoInfer<R> }): void | Promise<void>
  invalidatesFileList?:
    | boolean
    | ((args: ProjectFileUseCaseContext<I> & { result: NoInfer<R> }) => boolean)
}): AuthorizingUseCase<O, I, R> {
  return {
    operation: definition.operation,
    delegationAudience: definition.operation.delegationAudience,
    async authorize(args) {
      const authorize = await createProjectFileAuthorizer(
        args.principal,
        definition.operation,
        args.input
      )
      await db.transaction(authorize)
    },
    async execute(args) {
      let prepared: P | undefined
      let preparationContext: ProjectFileAuthorizationContext | undefined
      const prepare = definition.prepare
      if (prepare) {
        const preflight = await createProjectFileAuthorizer(
          args.principal,
          definition.operation,
          args.input
        )
        const context = await db.transaction(preflight)
        preparationContext = context
        prepared = await runWithOutboundOrganization(context.organizationId, () =>
          prepare({ ...args, context })
        )
      }
      let committed: { context: ProjectFileAuthorizationContext; result: R }
      try {
        const authorize = await createProjectFileAuthorizer(
          args.principal,
          definition.operation,
          args.input
        )
        committed = await db.transaction(async (tx) => {
          const context = await authorize(tx)
          const result = await runWithOutboundOrganization(context.organizationId, () =>
            definition.execute({ ...args, context, tx, prepared })
          )
          return { context, result }
        })
      } catch (error) {
        if (prepared !== undefined && preparationContext) {
          await definition.onCommitFailure?.({
            ...args,
            context: preparationContext,
            prepared,
            error,
          })
        }
        throw error
      }
      const { context, result } = committed
      const resultContext = { ...args, context, result }
      const invalidates = definition.invalidatesFileList
      if (typeof invalidates === 'function' ? invalidates(resultContext) : invalidates) {
        await notifyFileListChanged(context.owner)
      }
      const audit = definition.projectAudit?.(resultContext)
      if (audit !== undefined) {
        recordProjectedUseCaseAuditEntries(
          definition.operation,
          null,
          args.principal,
          args.request,
          Array.isArray(audit) ? audit : [audit],
          context.organizationId ?? undefined
        )
      }
      await definition.afterSuccess?.(resultContext)
      return result
    },
  }
}
