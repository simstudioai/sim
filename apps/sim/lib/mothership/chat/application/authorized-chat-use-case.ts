import type {
  OrganizationDelegatedPrincipal,
  PersonalChatDelegatedPrincipal,
  Principal,
} from '@sim/auth/principal'
import {
  type AuthorizingUseCase,
  defineAuthorizedWorkspaceUseCase,
  type PrincipalForOperation,
  requireAllowedWorkspacePrincipal,
  runDeclaredContentOperation,
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
import {
  bindCurrentChatCallback,
  requireRunDelegation,
} from '@/lib/mothership/request/application/run-authorization'

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

type ChatPrincipal<O extends WorkspaceOperation, Personal extends boolean = false> =
  | PrincipalForOperation<O>
  | ('delegated' extends O['principalKinds'][number] ? OrganizationDelegatedPrincipal : never)
  | ('delegated' extends O['principalKinds'][number]
      ? Personal extends true
        ? PersonalChatDelegatedPrincipal
        : never
      : never)

interface ChatExecution<
  O extends WorkspaceOperation,
  I,
  C extends ChatOwnerContext,
  Personal extends boolean,
> {
  principal: ChatPrincipal<O, Personal>
  /** Authenticated original admission, before current chat authorization is rebound. */
  executionPrincipal?: Principal
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
  Personal extends boolean = false,
>(definition: {
  operation: O
  /** Opt-in for internal execution callbacks; never enables public chat creation. */
  personal?: Personal
  executionDelegationAudience?: string
  organizationOperation: OrganizationOperation
  resolveContext(args: { principal: ChatPrincipal<O, Personal>; input: I }): C | Promise<C>
  authorizationOptions: WorkspaceAuthorizationOptions<C & WorkspaceAuthorizationContext>
  execute(args: ChatExecution<O, I, C, Personal>): Promise<R>
  afterSuccess?(args: ChatExecution<O, I, C, Personal> & { result: R }): void | Promise<void>
}): AuthorizingUseCase<O, I, R> {
  if (definition.operation.id !== definition.organizationOperation.id) {
    throw new Error('Chat owner policies must declare the same semantic operation')
  }
  type WorkspaceContext = C & WorkspaceAuthorizationContext
  type WorkspaceInput = {
    originalInput: I
    context: WorkspaceContext
    executionPrincipal?: Principal
  }
  const workspaceUseCase = defineAuthorizedWorkspaceUseCase<O, WorkspaceInput, WorkspaceContext, R>(
    {
      operation: definition.operation,
      resolveContext: ({ input }) => input.context,
      authorizationOptions: definition.authorizationOptions,
      execute: ({ principal, input, context, request }) =>
        definition.execute({
          principal,
          executionPrincipal: input.executionPrincipal,
          input: input.originalInput,
          context,
          request,
        }),
      afterSuccess: ({ principal, input, context, request, result }) =>
        definition.afterSuccess?.({
          principal,
          executionPrincipal: input.executionPrincipal,
          input: input.originalInput,
          context,
          request,
          result,
        }),
    }
  )
  function requirePrincipal(principal: Principal): asserts principal is ChatPrincipal<O, Personal> {
    if (principal.kind === 'personal_chat_delegated') {
      if (
        !definition.personal ||
        !definition.executionDelegationAudience ||
        !definition.operation.principalKinds.includes('delegated')
      )
        throw new OrchestrationError(
          'forbidden',
          'Personal chat delegation cannot perform this operation'
        )
      requireRunDelegation(
        principal,
        definition.executionDelegationAudience,
        principal.resourceScope.chatId
      )
    } else if (principal.kind !== 'organization_delegated') {
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
    const executionPrincipal = definition.executionDelegationAudience ? principal : undefined
    if (definition.executionDelegationAudience)
      principal = await bindCurrentChatCallback(
        principal,
        definition.executionDelegationAudience,
        definition.operation.capability
      )
    requirePrincipal(principal)
    const context = await definition.resolveContext({ principal, input })
    if (context.organizationId) {
      await authorizeOrganizationOperation(principal, definition.organizationOperation, {
        organizationId: context.organizationId,
      })
      requireDelegatedChatScope(principal, context)
      return {
        kind: 'organization' as const,
        executionPrincipal,
        organizationId: context.organizationId,
        principal,
        context,
      }
    }
    if (definition.personal && principal.kind === 'session' && !context.workspaceId)
      return {
        kind: 'personal' as const,
        organizationId: null,
        principal,
        executionPrincipal,
        context,
      }
    if (principal.kind === 'personal_chat_delegated') {
      const personal = principal as PersonalChatDelegatedPrincipal
      const audience = definition.executionDelegationAudience
      if (!audience) throw new OrchestrationError('forbidden', 'Missing chat delegation audience')
      if (
        context.workspaceId ||
        !('chatId' in context) ||
        context.chatId !== personal.resourceScope.chatId
      )
        throw new OrchestrationError('not_found', 'Chat not found')
      requireRunDelegation(principal, audience, personal.resourceScope.chatId)
      return {
        kind: 'personal' as const,
        organizationId: null,
        principal,
        executionPrincipal,
        context,
      }
    }
    if (principal.kind === 'organization_delegated')
      throw new OrchestrationError('not_found', 'Chat not found')
    requireWorkspace(context)
    return { kind: 'workspace' as const, principal, executionPrincipal, context }
  }
  return {
    operation: definition.operation,
    async authorize({ principal, input, request }) {
      const resolved = await resolve(principal, input)
      if (resolved.kind === 'workspace')
        await workspaceUseCase.authorize({
          principal: resolved.principal,
          input: {
            originalInput: input,
            context: resolved.context,
            executionPrincipal: resolved.executionPrincipal,
          },
          request,
        })
    },
    async execute({ principal, input, request }) {
      const resolved = await resolve(principal, input)
      if (resolved.kind === 'workspace')
        return workspaceUseCase.execute({
          principal: resolved.principal,
          input: {
            originalInput: input,
            context: resolved.context,
            executionPrincipal: resolved.executionPrincipal,
          },
          request,
        })
      const execution = {
        principal: resolved.principal,
        executionPrincipal: resolved.executionPrincipal,
        input,
        context: resolved.context,
        request,
      }
      return runWithOutboundOrganization(resolved.organizationId, () =>
        runDeclaredContentOperation(
          definition.operation,
          resolved.principal,
          () => definition.execute(execution),
          async (result) => {
            await definition.afterSuccess?.({ ...execution, result })
          }
        )
      )
    },
  }
}
