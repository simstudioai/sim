import type { Principal } from '@sim/auth/principal'
import { functionExecuteBodySchema } from '@/lib/api/contracts/hotspots'
import { defineWorkspaceOperation } from '@/lib/core/application'
import { defineOrganizationOperation } from '@/lib/core/application/organization-operation'
import { OrchestrationError } from '@/lib/core/orchestration/types'
import { FUNCTION_EXECUTION_DELEGATION_AUDIENCE } from '@/lib/function-execution/application/authorization'
import type { ExecuteFunctionInput } from '@/lib/function-execution/application/execute-function'
import { defineAuthorizedChatUseCase } from '@/lib/mothership/chat/application/authorized-chat-use-case'
import { resolveOwnedChatContext } from '@/lib/mothership/chat/application/context'
import { chatSandboxSessionKey } from '@/lib/mothership/tools/sandbox-session-key'

interface ExecuteChatFunctionInput extends Omit<ExecuteFunctionInput, 'workspaceId'> {
  organizationId: string
  chatId: string
}

/** Organization scratch execution belongs to the current private Build/Plan chat. */
export const executeChatFunction = defineAuthorizedChatUseCase({
  operation: defineWorkspaceOperation({
    id: 'function-executions.execute_chat',
    minimumRole: 'read',
    workspaceApiKey: 'deny',
    capability: 'copilot.use',
    principalKinds: ['delegated'],
    delegatedServices: ['copilot'],
  }),
  organizationOperation: defineOrganizationOperation({
    id: 'function-executions.execute_chat',
    minimumRole: 'member',
    capability: 'copilot.use',
    principalKinds: ['organization_delegated'],
    delegatedServices: ['copilot'],
    delegationAudience: FUNCTION_EXECUTION_DELEGATION_AUDIENCE,
  }),
  resolveContext: async ({
    principal,
    input,
  }: {
    principal: Principal
    input: ExecuteChatFunctionInput
  }) => {
    const context = await resolveOwnedChatContext(principal, input.chatId)
    if (
      context.organizationId !== input.organizationId ||
      context.workspaceId ||
      (context.mode !== 'agent' && context.mode !== 'plan')
    )
      throw new OrchestrationError('not_found', 'Organization Build or Plan chat not found')
    return context
  },
  authorizationOptions: {
    delegation: { audience: FUNCTION_EXECUTION_DELEGATION_AUDIENCE, isWithinScope: () => false },
  },
  execute: async ({ principal, input, context }) => {
    if (principal.kind !== 'organization_delegated')
      throw new OrchestrationError('forbidden', 'Organization chat authority required')
    const body = functionExecuteBodySchema.parse(input.body)
    if (
      body.sandboxSessionKey !== chatSandboxSessionKey(context.chatId) ||
      body.workspaceId ||
      body.workflowId ||
      body.sandboxId ||
      body.secretScope !== 'selected' ||
      body.fileKeys?.length ||
      body.largeValueKeys?.length ||
      body.largeValueExecutionIds?.length ||
      body.allowLargeValueWorkflowScope
    )
      throw new OrchestrationError(
        'validation',
        'Workspace files, saved sandboxes and workflow values require an explicit workspace target'
      )
    /** Only exact values from the server's authorized mount catalog may enter org scratch code. */
    const mountedNames = body.mountedSecrets ?? []
    if (
      new Set(mountedNames).size !== mountedNames.length ||
      Object.keys(body.envVars).length !== mountedNames.length ||
      mountedNames.some(
        (name) =>
          !Object.hasOwn(body.envVars, name) ||
          !input.resolvedSecretTraceRegistry?.recordResolved(name, body.envVars[name])
      )
    )
      throw new OrchestrationError(
        'forbidden',
        'Organization code secrets require an authorized mount'
      )
    const { executeFunctionRequest } = await import('@/lib/function-execution/execute-request')
    return executeFunctionRequest(
      { headers: input.headers, signal: input.signal ?? new AbortController().signal },
      body,
      {
        attributedUserId: context.userId,
        fileAccessUserId: context.userId,
        principal,
        sandboxProfile: 'mothership',
        resolvedSecretTraceRegistry: input.resolvedSecretTraceRegistry,
      }
    )
  },
})
