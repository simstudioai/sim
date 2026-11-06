import {
  type AuditActionType,
  type AuditLogParams,
  type AuditResourceTypeValue,
  type AuditRollupSummary,
  recordAudit,
  recordAuditOnce,
  recordAuditRollup,
} from '@sim/audit'
import type { Principal, PrincipalActor, PrincipalAuditAttribution } from '@sim/auth/principal'
import { resolvePrincipalAuditAttribution } from '@sim/auth/principal'
import { createLogger } from '@sim/logger'
import { toNumberOrNull, toStringOrNull } from '@sim/utils/coerce'
import { runDeclaredContentOperation } from '@/lib/core/application/content-delivery'
import type { ApplicationOperation, OperationUseCase } from '@/lib/core/application/operation'
import {
  authorizeWorkspaceOperation,
  requireAllowedWorkspacePrincipal,
  type WorkspaceAuthorizationContext,
  type WorkspaceAuthorizationOptions,
} from '@/lib/core/application/workspace-authorization'
import { withinAuthorizedWorkspaceOperation } from '@/lib/core/application/workspace-invocation-scope'
import type {
  PrincipalForOperation,
  WorkspaceOperation,
} from '@/lib/core/application/workspace-operation'
import { runWithOutboundOrganization } from '@/lib/core/network/context.server'
import type { OrchestrationRequestContext } from '@/lib/core/orchestration/types'
import type { ResourcePolicyBinding } from '@/lib/resource-policies/registry'

const logger = createLogger('WorkspaceUseCaseAudit')

/** The audit actor of a workflow-execution delegation that names its run. */
type ExecutionDelegatedActor = Extract<PrincipalActor, { kind: 'delegated' }> & {
  executionId: string
}

export interface WorkspaceUseCaseAuditEntry {
  /** Canonical affected workspace; null keeps an organization event outside the authorization workspace. */
  workspaceId?: string | null
  action: AuditActionType
  resourceType: AuditResourceTypeValue
  resourceId?: string
  resourceName?: string
  description?: string
  metadata?: Record<string, unknown>
  /**
   * Records the entry at most once for this key, for an operation a caller may
   * retry after losing its response: each retry projects the same entry again.
   */
  idempotencyKey?: string
  /**
   * Merges this entry with its repeats from the same workflow execution into
   * one row, keeping every count and identifier (see `recordAuditRollup`).
   * Applies only to an executor delegation that names its execution; every
   * other caller records the entry as usual.
   */
  executionRollup?: WorkspaceUseCaseAuditRollup
}

export interface WorkspaceUseCaseAuditRollup {
  /** Metadata keys summed across merged entries. */
  counterKeys: readonly string[]
  /** Metadata keys collected into a `<key>s` array on a merged row. */
  identifierKeys: readonly string[]
  describe(summary: AuditRollupSummary): string
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
  /** Receives the operation-owned policy binding when the operation declares one. */
  authorizeResource?(args: AuthorizedWorkspaceResourceUseCaseContext<O, I, C>): void | Promise<void>
  execute(args: AuthorizedWorkspaceUseCaseContext<O, I, C>): Promise<R>
  projectAudit?(
    args: AuthorizedWorkspaceUseCaseResultContext<O, I, C, R>
  ): WorkspaceUseCaseAuditEntry | WorkspaceUseCaseAuditEntry[]
  afterSuccess?(args: AuthorizedWorkspaceUseCaseResultContext<O, I, C, R>): void | Promise<void>
}

type ResourcePolicyForOperation<O extends WorkspaceOperation> = O extends {
  readonly resourcePolicy: infer Binding extends ResourcePolicyBinding
}
  ? Binding
  : never

export type AuthorizedWorkspaceResourceUseCaseContext<
  O extends WorkspaceOperation,
  I,
  C extends WorkspaceAuthorizationContext,
> = AuthorizedWorkspaceUseCaseContext<O, I, C> & {
  resourcePolicy: ResourcePolicyForOperation<O>
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

export function recordProjectedUseCaseAuditEntries(
  operation: ApplicationOperation,
  workspaceId: string | null | undefined,
  principal: Principal,
  request: OrchestrationRequestContext | undefined,
  entries: readonly WorkspaceUseCaseAuditEntry[],
  organizationId?: string
): void {
  const attribution: PrincipalAuditAttribution = resolvePrincipalAuditAttribution(principal)
  const { actor } = attribution
  const rollupActor =
    actor.kind === 'delegated' && actor.executionId && !request
      ? { ...actor, executionId: actor.executionId }
      : undefined
  for (const { idempotencyKey, executionRollup, ...entry } of entries) {
    const params = {
      workspaceId: entry.workspaceId === undefined ? workspaceId : entry.workspaceId,
      actorId: attribution.actorId,
      actorName: attribution.actorName,
      action: entry.action,
      resourceType: entry.resourceType,
      resourceId: entry.resourceId,
      resourceName: entry.resourceName,
      description: entry.description,
      metadata: {
        ...entry.metadata,
        ...(organizationId ? { organizationId } : {}),
        operation: operation.id,
        actor: attribution.actor,
      },
      request,
    }
    if (executionRollup && rollupActor && !idempotencyKey) {
      recordExecutionAuditRollup(params, rollupActor, executionRollup)
      continue
    }
    if (!idempotencyKey) {
      recordAudit(params)
      continue
    }
    recordAuditOnce(idempotencyKey, params).catch((error) => {
      logger.error('Failed to record audit log', { error, action: params.action })
    })
  }
}

/**
 * Entries merge when everything but their counters, identifiers, and the
 * per-call delegation matches, so a merged row never blends two operations.
 */
function recordExecutionAuditRollup(
  params: AuditLogParams & { metadata: Record<string, unknown> },
  { delegationId, ...sharedActor }: ExecutionDelegatedActor,
  rollup: WorkspaceUseCaseAuditRollup
): void {
  const shared: Record<string, unknown> = { ...params.metadata, actor: sharedActor }
  const counters: Record<string, number> = {}
  const identifiers: Record<string, string | undefined> = { delegationId }
  for (const key of rollup.counterKeys) {
    const value = toNumberOrNull(shared[key])
    if (value !== null) counters[key] = value
    delete shared[key]
  }
  for (const key of rollup.identifierKeys) {
    identifiers[key] = toStringOrNull(shared[key]) ?? undefined
    delete shared[key]
  }
  recordAuditRollup({
    key: JSON.stringify(shared),
    params,
    rollupMetadata: shared,
    counters,
    identifiers,
    describe: rollup.describe,
  })
}

/**
 * A use case that always answers `authorize`, so a caller that must run the
 * funnel without executing — a `HEAD` on a route declaring `headSafe: false`,
 * or a wrapping domain builder — can rely on it without a runtime guard.
 */
export type AuthorizingUseCase<O extends ApplicationOperation, I, R> = OperationUseCase<O, I, R> &
  Required<Pick<OperationUseCase<O, I, R>, 'authorize'>>

export function defineAuthorizedWorkspaceUseCase<
  const O extends WorkspaceOperation,
  I,
  C extends WorkspaceAuthorizationContext,
  R,
>(definition: AuthorizedWorkspaceUseCaseDefinition<O, I, C, R>): AuthorizingUseCase<O, I, R> {
  const resourceAuthorization = (() => {
    const { authorizeResource, operation } = definition
    const resourcePolicy = ('resourcePolicy' in operation ? operation.resourcePolicy : undefined) as
      | ResourcePolicyForOperation<O>
      | undefined

    if (resourcePolicy && !authorizeResource) {
      throw new Error(`Operation ${operation.id} requires resource policy authorization`)
    }
    if (!authorizeResource) return undefined

    return (executionContext: AuthorizedWorkspaceUseCaseContext<O, I, C>) =>
      authorizeResource({
        ...executionContext,
        resourcePolicy,
      } as AuthorizedWorkspaceResourceUseCaseContext<O, I, C>)
  })()

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
    await resourceAuthorization?.(executionContext)
    return executionContext
  }

  return {
    operation: definition.operation,
    ...(!isAuthorizationOptionsResolver(definition.authorizationOptions) &&
    definition.operation.principalKinds.includes('delegated') &&
    'delegatedServices' in definition.operation &&
    definition.operation.delegatedServices?.includes('copilot') &&
    definition.authorizationOptions.delegation
      ? { delegationAudience: definition.authorizationOptions.delegation.audience }
      : {}),
    async authorize(args) {
      await authorizePhase(args)
    },
    async execute(args) {
      const executionContext = await authorizePhase(args)
      const { principal, context, request } = executionContext
      return runWithOutboundOrganization(context.workspaceOrganizationId, () =>
        runDeclaredContentOperation(
          definition.operation,
          principal,
          () => withinAuthorizedWorkspaceOperation(() => definition.execute(executionContext)),
          async (result) => {
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
          }
        )
      )
    },
  }
}
