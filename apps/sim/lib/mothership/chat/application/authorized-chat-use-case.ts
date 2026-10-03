import type { OrganizationDelegatedPrincipal, Principal } from '@sim/auth/principal'
import {
  type AuthorizingUseCase,
  defineAuthorizedWorkspaceUseCase,
  type PrincipalForOperation,
  requireAllowedWorkspacePrincipal,
  type WorkspaceAuthorizationContext,
  type WorkspaceAuthorizationOptions,
  type WorkspaceOperation,
} from '@/lib/core/application'
import { authorizeOrganizationOperation } from '@/lib/core/application/organization-authorization'
import type { OrganizationOperation } from '@/lib/core/application/organization-operation'
import { runWithOutboundOrganization } from '@/lib/core/network/context.server'
import {
  OrchestrationError,
  type OrchestrationRequestContext,
} from '@/lib/core/orchestration/types'
import type { ChatOwnerContext } from '@/lib/mothership/chat/application/context'

function requireDelegatedChatScope(principal: Principal, context: ChatOwnerContext): void {
  if (
    principal.kind === 'organization_delegated' &&
    (principal.serviceId !== 'copilot' ||
      !('chatId' in context) ||
      principal.resourceScope.chatId !== context.chatId)
  ) {
    throw new OrchestrationError('not_found', 'Chat not found')
  }
}

type ChatPrincipal<O extends WorkspaceOperation> =
  | PrincipalForOperation<O>
  | ('delegated' extends O['principalKinds'][number] ? OrganizationDelegatedPrincipal : never)

interface ChatExecution<O extends WorkspaceOperation, I, C extends ChatOwnerContext> {
  principal: ChatPrincipal<O>
  input: I
  context: C
  request?: OrchestrationRequestContext
}

/** Binds one private-chat operation to the existing owner-specific authorization funnels. */
export function defineAuthorizedChatUseCase<
  O extends WorkspaceOperation,
  I,
  C extends ChatOwnerContext,
  R,
>(definition: {
  operation: O
  organizationOperation: OrganizationOperation
  resolveContext(args: { principal: ChatPrincipal<O>; input: I }): C | Promise<C>
  authorizationOptions: WorkspaceAuthorizationOptions<C & WorkspaceAuthorizationContext>
  execute(args: ChatExecution<O, I, C>): Promise<R>
  afterSuccess?(args: ChatExecution<O, I, C> & { result: R }): void | Promise<void>
}): AuthorizingUseCase<O, I, R> {
  if (definition.operation.id !== definition.organizationOperation.id) {
    throw new Error('Chat owner policies must declare the same semantic operation')
  }
  type WorkspaceContext = C & WorkspaceAuthorizationContext
  type WorkspaceInput = { originalInput: I; context: WorkspaceContext }
  const workspaceUseCase = defineAuthorizedWorkspaceUseCase<O, WorkspaceInput, WorkspaceContext, R>(
    {
      operation: definition.operation,
      resolveContext: ({ input }) => input.context,
      authorizationOptions: definition.authorizationOptions,
      execute: ({ principal, input, context, request }) =>
        definition.execute({ principal, input: input.originalInput, context, request }),
      afterSuccess: ({ principal, input, context, request, result }) =>
        definition.afterSuccess?.({
          principal,
          input: input.originalInput,
          context,
          request,
          result,
        }),
    }
  )
  function requirePrincipal(principal: Principal): asserts principal is ChatPrincipal<O> {
    if (principal.kind !== 'organization_delegated') {
      requireAllowedWorkspacePrincipal(principal, definition.operation)
    } else if (!definition.organizationOperation.principalKinds.includes(principal.kind)) {
      throw new OrchestrationError(
        'forbidden',
        'Organization delegation cannot perform this operation'
      )
    }
  }
  function requireWorkspace(context: C): asserts context is WorkspaceContext {
    if (!context.workspaceId) throw new OrchestrationError('not_found', 'Chat not found')
  }
  async function resolve(principal: Principal, input: I) {
    requirePrincipal(principal)
    const context = await definition.resolveContext({ principal, input })
    if (context.organizationId) {
      await authorizeOrganizationOperation(principal, definition.organizationOperation, {
        organizationId: context.organizationId,
      })
      requireDelegatedChatScope(principal, context)
      return {
        kind: 'organization' as const,
        organizationId: context.organizationId,
        principal,
        context,
      }
    }
    if (principal.kind === 'organization_delegated')
      throw new OrchestrationError('not_found', 'Chat not found')
    requireWorkspace(context)
    return { kind: 'workspace' as const, principal, context }
  }
  return {
    operation: definition.operation,
    async authorize({ principal, input, request }) {
      const resolved = await resolve(principal, input)
      if (resolved.kind === 'workspace')
        await workspaceUseCase.authorize({
          principal: resolved.principal,
          input: { originalInput: input, context: resolved.context },
          request,
        })
    },
    async execute({ principal, input, request }) {
      const resolved = await resolve(principal, input)
      if (resolved.kind === 'workspace')
        return workspaceUseCase.execute({
          principal: resolved.principal,
          input: { originalInput: input, context: resolved.context },
          request,
        })
      const execution = { principal: resolved.principal, input, context: resolved.context, request }
      return runWithOutboundOrganization(resolved.organizationId, async () => {
        const result = await definition.execute(execution)
        await definition.afterSuccess?.({ ...execution, result })
        return result
      })
    },
  }
}
