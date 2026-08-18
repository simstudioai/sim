import { type AuditActionType, type AuditResourceTypeValue, recordAudit } from '@sim/audit'
import type { Principal, PrincipalAuditAttribution } from '@sim/auth/principal'
import { resolvePrincipalAuditAttribution } from '@sim/auth/principal'
import type { OperationUseCase } from '@/lib/core/application/operation'
import {
  authorizeWorkspaceOperation,
  requireAllowedWorkspacePrincipal,
  type WorkspaceAuthorizationContext,
  type WorkspaceAuthorizationOptions,
} from '@/lib/core/application/workspace-authorization'
import type {
  PrincipalForOperation,
  WorkspaceOperation,
} from '@/lib/core/application/workspace-operation'
import type { OrchestrationRequestContext } from '@/lib/core/orchestration/types'

export interface WorkspaceUseCaseAuditEntry {
  action: AuditActionType
  resourceType: AuditResourceTypeValue
  resourceId?: string
  resourceName?: string
  description?: string
  metadata?: Record<string, unknown>
}

export interface AuthorizedWorkspaceUseCaseContext<
  O extends WorkspaceOperation,
  I,
  C extends WorkspaceAuthorizationContext,
> {
  principal: PrincipalForOperation<O>
  input: I
  context: C
  request?: OrchestrationRequestContext
}

export interface AuthorizedWorkspaceUseCaseResultContext<
  O extends WorkspaceOperation,
  I,
  C extends WorkspaceAuthorizationContext,
  R,
> extends AuthorizedWorkspaceUseCaseContext<O, I, C> {
  result: R
}

export interface AuthorizedWorkspaceUseCaseDefinition<
  O extends WorkspaceOperation,
  I,
  C extends WorkspaceAuthorizationContext,
  R,
> {
  operation: O
  resolveContext(args: { principal: PrincipalForOperation<O>; input: I }): C | Promise<C>
  authorizationOptions:
    | WorkspaceAuthorizationOptions<C>
    | ((
        args: AuthorizedWorkspaceUseCaseContext<O, I, C>
      ) => WorkspaceAuthorizationOptions<C> | Promise<WorkspaceAuthorizationOptions<C>>)
  /** Applies current domain-resource policy after workspace authorization. */
  authorizeResource?(args: AuthorizedWorkspaceUseCaseContext<O, I, C>): void | Promise<void>
  execute(args: AuthorizedWorkspaceUseCaseContext<O, I, C>): Promise<R>
  projectAudit?(
    args: AuthorizedWorkspaceUseCaseResultContext<O, I, C, R>
  ): WorkspaceUseCaseAuditEntry | WorkspaceUseCaseAuditEntry[]
  afterSuccess?(args: AuthorizedWorkspaceUseCaseResultContext<O, I, C, R>): void | Promise<void>
}

function isAuthorizationOptionsResolver<
  O extends WorkspaceOperation,
  I,
  C extends WorkspaceAuthorizationContext,
>(
  options: AuthorizedWorkspaceUseCaseDefinition<O, I, C, unknown>['authorizationOptions']
): options is (
  args: AuthorizedWorkspaceUseCaseContext<O, I, C>
) => WorkspaceAuthorizationOptions<C> | Promise<WorkspaceAuthorizationOptions<C>> {
  return typeof options === 'function'
}

export function recordProjectedUseCaseAuditEntries<O extends WorkspaceOperation>(
  operation: O,
  workspaceId: string | null | undefined,
  principal: PrincipalForOperation<O>,
  request: OrchestrationRequestContext | undefined,
  entries: readonly WorkspaceUseCaseAuditEntry[]
): void {
  const attribution: PrincipalAuditAttribution = resolvePrincipalAuditAttribution(principal)
  for (const entry of entries) {
    recordAudit({
      workspaceId,
      actorId: attribution.actorId,
      actorName: attribution.actorName,
      action: entry.action,
      resourceType: entry.resourceType,
      resourceId: entry.resourceId,
      resourceName: entry.resourceName,
      description: entry.description,
      metadata: {
        ...entry.metadata,
        operation: operation.id,
        actor: attribution.actor,
      },
      request,
    })
  }
}

export function defineAuthorizedWorkspaceUseCase<
  const O extends WorkspaceOperation,
  I,
  C extends WorkspaceAuthorizationContext,
  R,
>(definition: AuthorizedWorkspaceUseCaseDefinition<O, I, C, R>): OperationUseCase<O, I, R> {
  /**
   * Everything that runs before the business transaction: allowed-principal
   * check, canonical load, asserted-scope comparison, current workspace and
   * resource access checks.
   *
   * `execute` and `authorize` share it rather than each spelling it out, so a
   * `HEAD` probe cannot answer a different question from the `GET` it stands
   * for. It hands back the context it already loaded so the two phases together
   * cost the same reads `execute` alone used to.
   */
  async function authorizePhase({
    principal,
    input,
    request,
  }: {
    principal: Principal
    input: I
    request?: OrchestrationRequestContext
  }): Promise<AuthorizedWorkspaceUseCaseContext<O, I, C>> {
    requireAllowedWorkspacePrincipal(principal, definition.operation)
    const context = await definition.resolveContext({ principal, input })
    const executionContext: AuthorizedWorkspaceUseCaseContext<O, I, C> = {
      principal,
      input,
      context,
      request,
    }
    const authorizationOptions = isAuthorizationOptionsResolver(definition.authorizationOptions)
      ? await definition.authorizationOptions(executionContext)
      : definition.authorizationOptions

    await authorizeWorkspaceOperation(
      principal,
      definition.operation,
      context,
      authorizationOptions
    )
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
      const { principal, context, request } = executionContext
      const result = await definition.execute(executionContext)
      const resultContext = { ...executionContext, result }
      const projectedAudit = definition.projectAudit?.(resultContext)
      if (projectedAudit !== undefined) {
        const auditEntries = Array.isArray(projectedAudit) ? projectedAudit : [projectedAudit]
        if (auditEntries.length > 0) {
          recordProjectedUseCaseAuditEntries(
            definition.operation,
            context.workspaceId,
            principal,
            request,
            auditEntries
          )
        }
      }
      await definition.afterSuccess?.(resultContext)
      return result
    },
  }
}
