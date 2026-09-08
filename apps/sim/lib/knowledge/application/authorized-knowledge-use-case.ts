import type { OrganizationDelegatedPrincipal, Principal } from '@sim/auth/principal'
import {
  defineAuthorizedWorkspaceUseCase,
  type OperationUseCase,
  type PrincipalForOperation,
  recordProjectedUseCaseAuditEntries,
  requireAllowedWorkspacePrincipal,
  type WorkspaceUseCaseAuditEntry,
} from '@/lib/core/application'
import { authorizeOrganizationOperation } from '@/lib/core/application/organization-authorization'
import {
  OrchestrationError,
  type OrchestrationRequestContext,
} from '@/lib/core/orchestration/types'
import {
  type KnowledgeAuthorizationContext,
  type KnowledgeResourceAuthorizationContext,
  knowledgeDelegationPolicy,
  type LegacyPersonalKnowledgeAuthorizationContext,
} from '@/lib/knowledge/application/authorization'
import { resolveKnowledgeAttributedUserId } from '@/lib/knowledge/application/billing'
import type { ScopedKnowledgeOperation } from '@/lib/knowledge/application/operations'

type KnowledgePrincipalForOperation<O extends ScopedKnowledgeOperation> =
  | PrincipalForOperation<O>
  | ('copilot' extends NonNullable<O['delegatedServices']>[number]
      ? O['minimumRole'] extends 'read'
        ? OrganizationDelegatedPrincipal
        : never
      : never)

function requireKnowledgePrincipal<O extends ScopedKnowledgeOperation>(
  principal: Principal,
  operation: O
): asserts principal is KnowledgePrincipalForOperation<O> {
  if (principal.kind !== 'organization_delegated')
    return requireAllowedWorkspacePrincipal(principal, operation)
  if (operation.minimumRole !== 'read' || !operation.delegatedServices?.includes('copilot')) {
    throw new OrchestrationError(
      'forbidden',
      'Organization delegation cannot perform this operation'
    )
  }
}

interface AuthorizedKnowledgeUseCaseContext<
  O extends ScopedKnowledgeOperation,
  I,
  C extends KnowledgeResourceAuthorizationContext,
> {
  principal: KnowledgePrincipalForOperation<O>
  input: I
  context: C
  request?: OrchestrationRequestContext
}

interface AuthorizedKnowledgeUseCaseResultContext<
  O extends ScopedKnowledgeOperation,
  I,
  C extends KnowledgeResourceAuthorizationContext,
  R,
> extends AuthorizedKnowledgeUseCaseContext<O, I, C> {
  result: R
}

interface AuthorizedKnowledgeUseCaseDefinition<
  O extends ScopedKnowledgeOperation,
  I,
  C extends KnowledgeResourceAuthorizationContext,
  R,
> {
  operation: O
  resolveContext(args: { principal: KnowledgePrincipalForOperation<O>; input: I }): C | Promise<C>
  execute(args: AuthorizedKnowledgeUseCaseContext<O, I, C>): Promise<R>
  projectAudit?(
    args: AuthorizedKnowledgeUseCaseResultContext<O, I, C, R>
  ): WorkspaceUseCaseAuditEntry | WorkspaceUseCaseAuditEntry[]
  afterSuccess?(args: AuthorizedKnowledgeUseCaseResultContext<O, I, C, R>): void | Promise<void>
}

function isLegacyPersonalKnowledgeContext(
  context: KnowledgeResourceAuthorizationContext
): context is LegacyPersonalKnowledgeAuthorizationContext {
  return context.workspaceId === undefined && context.organizationId === undefined
}

function assertWorkspaceKnowledgeContext<C extends KnowledgeResourceAuthorizationContext>(
  context: C
): asserts context is C & KnowledgeAuthorizationContext {
  if (context.workspaceId === undefined) {
    throw new Error('Expected a workspace-scoped Knowledge authorization context')
  }
}

export function defineAuthorizedKnowledgeUseCase<
  const O extends ScopedKnowledgeOperation,
  I,
  C extends KnowledgeResourceAuthorizationContext,
  R,
>(definition: AuthorizedKnowledgeUseCaseDefinition<O, I, C, R>): OperationUseCase<O, I, R> {
  type WorkspaceContext = C & KnowledgeAuthorizationContext
  type WorkspaceInput = { originalInput: I; context: WorkspaceContext }
  const projectAudit = definition.projectAudit
  const afterSuccess = definition.afterSuccess

  const workspaceUseCase = defineAuthorizedWorkspaceUseCase<O, WorkspaceInput, WorkspaceContext, R>(
    {
      operation: definition.operation,
      resolveContext: ({ input }: { input: WorkspaceInput }) => input.context,
      authorizationOptions: { delegation: knowledgeDelegationPolicy },
      execute: ({ principal, input, context, request }) =>
        definition.execute({
          principal,
          input: input.originalInput,
          context,
          request,
        }),
      ...(projectAudit
        ? {
            projectAudit: ({ principal, input, context, request, result }) =>
              projectAudit({
                principal,
                input: input.originalInput,
                context,
                request,
                result,
              }),
          }
        : {}),
      ...(afterSuccess
        ? {
            afterSuccess: ({ principal, input, context, request, result }) =>
              afterSuccess({
                principal,
                input: input.originalInput,
                context,
                request,
                result,
              }),
          }
        : {}),
    }
  )

  return {
    operation: definition.operation,
    async execute({ principal, input, request }) {
      requireKnowledgePrincipal(principal, definition.operation)
      const context = await definition.resolveContext({ principal, input })
      if (context.organizationId) {
        await authorizeOrganizationOperation(
          principal,
          definition.operation.organizationOperation,
          context
        )
        const result = await definition.execute({ principal, input, context, request })
        const resultContext = { principal, input, context, request, result }
        const projectedAudit = definition.projectAudit?.(resultContext)
        if (projectedAudit !== undefined) {
          recordProjectedUseCaseAuditEntries(
            definition.operation,
            undefined,
            principal,
            request,
            Array.isArray(projectedAudit) ? projectedAudit : [projectedAudit],
            context.organizationId
          )
        }
        await definition.afterSuccess?.(resultContext)
        return result
      }
      if (principal.kind === 'organization_delegated')
        throw new OrchestrationError('not_found', 'Knowledge base not found')
      if (isLegacyPersonalKnowledgeContext(context)) {
        if (
          principal.kind === 'workspace_api_key' ||
          resolveKnowledgeAttributedUserId(principal, context) !== context.legacyPersonalOwnerUserId
        ) {
          throw new OrchestrationError('not_found', 'Knowledge base not found')
        }
        const executionContext = { principal, input, context, request }
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
      }

      assertWorkspaceKnowledgeContext(context)
      return workspaceUseCase.execute({
        principal,
        input: { originalInput: input, context },
        request,
      })
    },
  }
}
