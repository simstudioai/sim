import {
  resolvePrincipalAttribution,
  type WorkflowExecutionDelegatedPrincipal,
} from '@sim/auth/principal'
import { defineAuthorizedWorkspaceUseCase } from '@/lib/core/application'
import { OrchestrationError } from '@/lib/core/orchestration/types'
import { memoryDelegationPolicy } from '@/lib/memory/application/authorization'
import { memoryOperations } from '@/lib/memory/application/operations'
import { readMemoryArtifact, storeMemoryArtifact } from '@/lib/memory/artifacts'
import {
  type AgentMemoryTurnIdentity,
  type AppendAgentMemoryMessageInput,
  appendAgentMemoryMessage,
  openAgentMemoryTurn,
  type ReadConversationItemsInput,
  type ReadConversationPrefixInput,
  readConversationItems,
  readConversationPrefix,
  type SaveAgentMemoryTurnInput,
  saveAgentMemoryTurn,
} from '@/lib/memory/conversation-store'
import { resolveActiveWorkspaceApplicationContext } from '@/lib/workspaces/application/workspace-context'

function requireMatchingInvocation(
  principal: WorkflowExecutionDelegatedPrincipal,
  identity: AgentMemoryTurnIdentity
): void {
  const delegation = principal.delegationContext
  const workflowId = delegation?.currentWorkflow?.workflowId ?? delegation?.workflowId
  if (workflowId !== identity.workflowId || delegation?.executionId !== identity.executionId) {
    throw new OrchestrationError(
      'forbidden',
      'Agent memory invocation does not match the execution'
    )
  }
  if (
    !identity.conversationId.trim() ||
    identity.conversationId.length > 255 ||
    !identity.nodeId ||
    !identity.blockId ||
    !Number.isSafeInteger(identity.executionOrder) ||
    identity.executionOrder < 0
  ) {
    throw new OrchestrationError('validation', 'Invalid Agent memory invocation')
  }
}

export const openAgentMemoryTurnUseCase = defineAuthorizedWorkspaceUseCase({
  operation: memoryOperations.openTurn,
  resolveContext: ({ input }: { input: AgentMemoryTurnIdentity }) =>
    resolveActiveWorkspaceApplicationContext(input.workspaceId),
  authorizationOptions: { delegation: memoryDelegationPolicy },
  async execute({ principal, input, context }) {
    requireMatchingInvocation(principal, input)
    return openAgentMemoryTurn({ ...input, workspaceId: context.workspaceId })
  },
})

export const saveAgentMemoryTurnUseCase = defineAuthorizedWorkspaceUseCase({
  operation: memoryOperations.saveTurn,
  resolveContext: ({ input }: { input: SaveAgentMemoryTurnInput }) =>
    resolveActiveWorkspaceApplicationContext(input.workspaceId),
  authorizationOptions: { delegation: memoryDelegationPolicy },
  async execute({ principal, input, context }) {
    requireMatchingInvocation(principal, input)
    if (!Number.isSafeInteger(input.expectedRevision) || input.expectedRevision < 0) {
      throw new OrchestrationError('validation', 'Invalid Agent memory checkpoint revision')
    }
    return saveAgentMemoryTurn({ ...input, workspaceId: context.workspaceId })
  },
})

export const readAgentMemoryItemsUseCase = defineAuthorizedWorkspaceUseCase({
  operation: memoryOperations.readItems,
  resolveContext: ({ input }: { input: ReadConversationItemsInput }) =>
    resolveActiveWorkspaceApplicationContext(input.workspaceId),
  authorizationOptions: { delegation: memoryDelegationPolicy },
  execute: async ({ input, context }) =>
    readConversationItems({ ...input, workspaceId: context.workspaceId }),
})

export const storeAgentMemoryArtifactUseCase = defineAuthorizedWorkspaceUseCase({
  operation: memoryOperations.storeArtifact,
  resolveContext: ({
    input,
  }: {
    input: Omit<Parameters<typeof storeMemoryArtifact>[0], 'attributedUserId'>
  }) => resolveActiveWorkspaceApplicationContext(input.workspaceId),
  authorizationOptions: { delegation: memoryDelegationPolicy },
  async execute({ principal, input, context }) {
    const delegation = principal.delegationContext
    if (
      (delegation?.currentWorkflow?.workflowId ?? delegation?.workflowId) !== input.workflowId ||
      delegation?.executionId !== input.executionId
    ) {
      throw new OrchestrationError(
        'forbidden',
        'Agent memory artifact does not match the execution'
      )
    }
    const attribution = resolvePrincipalAttribution(principal, {
      workspaceBillingOwnerUserId: context.billedAccountUserId,
    })
    return storeMemoryArtifact({
      ...input,
      workspaceId: context.workspaceId,
      attributedUserId: attribution.attributedUserId,
    })
  },
})

export const readAgentMemoryArtifactUseCase = defineAuthorizedWorkspaceUseCase({
  operation: memoryOperations.readArtifact,
  resolveContext: ({ input }: { input: Parameters<typeof readMemoryArtifact>[0] }) =>
    resolveActiveWorkspaceApplicationContext(input.workspaceId),
  authorizationOptions: { delegation: memoryDelegationPolicy },
  execute: async ({ input, context }) =>
    readMemoryArtifact({ ...input, workspaceId: context.workspaceId }),
})

export const readAgentMemoryPrefixUseCase = defineAuthorizedWorkspaceUseCase({
  operation: memoryOperations.readItems,
  resolveContext: ({ input }: { input: ReadConversationPrefixInput }) =>
    resolveActiveWorkspaceApplicationContext(input.workspaceId),
  authorizationOptions: { delegation: memoryDelegationPolicy },
  execute: async ({ input, context }) =>
    readConversationPrefix({ ...input, workspaceId: context.workspaceId }),
})

export const appendAgentMemoryMessageUseCase = defineAuthorizedWorkspaceUseCase({
  operation: memoryOperations.appendTurnMessage,
  resolveContext: ({ input }: { input: AppendAgentMemoryMessageInput }) =>
    resolveActiveWorkspaceApplicationContext(input.workspaceId),
  authorizationOptions: { delegation: memoryDelegationPolicy },
  async execute({ principal, input, context }) {
    const delegation = principal.delegationContext
    const workflowId = delegation?.currentWorkflow?.workflowId ?? delegation?.workflowId
    const executionId = delegation?.executionId
    if (!workflowId || !executionId)
      throw new OrchestrationError('forbidden', 'Agent memory requires an execution identity')
    return appendAgentMemoryMessage({
      ...input,
      workspaceId: context.workspaceId,
      workflowId,
      executionId,
    })
  },
})
