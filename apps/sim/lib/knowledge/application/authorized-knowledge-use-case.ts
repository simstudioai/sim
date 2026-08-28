import {
  defineAuthorizedWorkspaceUseCase,
  type OperationUseCase,
  type PrincipalForOperation,
  recordProjectedUseCaseAuditEntries,
  requireAllowedWorkspacePrincipal,
  type WorkspaceOperation,
  type WorkspaceUseCaseAuditEntry,
} from '@/lib/core/application'
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

interface AuthorizedKnowledgeUseCaseContext<
  O extends WorkspaceOperation,
  I,
  C extends KnowledgeResourceAuthorizationContext,
> {
  principal: PrincipalForOperation<O>
  input: I
  context: C
  request?: OrchestrationRequestContext
}

interface AuthorizedKnowledgeUseCaseResultContext<
  O extends WorkspaceOperation,
  I,
  C extends KnowledgeResourceAuthorizationContext,
  R,
> extends AuthorizedKnowledgeUseCaseContext<O, I, C> {
  result: R
}

interface AuthorizedKnowledgeUseCaseDefinition<
  O extends WorkspaceOperation,
  I,
  C extends KnowledgeResourceAuthorizationContext,
  R,
> {
  operation: O
  resolveContext(args: { principal: PrincipalForOperation<O>; input: I }): C | Promise<C>
  execute(args: AuthorizedKnowledgeUseCaseContext<O, I, C>): Promise<R>
  projectAudit?(
    args: AuthorizedKnowledgeUseCaseResultContext<O, I, C, R>
  ): WorkspaceUseCaseAuditEntry | WorkspaceUseCaseAuditEntry[]
  afterSuccess?(args: AuthorizedKnowledgeUseCaseResultContext<O, I, C, R>): void | Promise<void>
}

function isLegacyPersonalKnowledgeContext(
  context: KnowledgeResourceAuthorizationContext
): context is LegacyPersonalKnowledgeAuthorizationContext {
  return context.workspaceId === undefined
}

function assertWorkspaceKnowledgeContext<C extends KnowledgeResourceAuthorizationContext>(
  context: C
): asserts context is C & KnowledgeAuthorizationContext {
  if (isLegacyPersonalKnowledgeContext(context)) {
    throw new Error('Expected a workspace-scoped Knowledge authorization context')
  }
}

function withExecutionActor<C extends KnowledgeResourceAuthorizationContext>(
  context: C,
  executionActorUserId?: string
): C {
  return executionActorUserId ? { ...context, executionActorUserId } : context
}

export function defineAuthorizedKnowledgeUseCase<
  const O extends WorkspaceOperation,
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
      requireAllowedWorkspacePrincipal(principal, definition.operation)
      const resolvedContext = await definition.resolveContext({ principal, input })
      const context = withExecutionActor(resolvedContext, request?.executionActorUserId)
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
