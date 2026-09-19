import { defineAuthorizedWorkspaceUseCase } from '@/lib/core/application'
import { OrchestrationError } from '@/lib/core/orchestration/types'
import { memoryDelegationPolicy } from '@/lib/memory/application/authorization'
import { memoryOperations } from '@/lib/memory/application/operations'
import {
  memoryRetrievalArgumentsSchema,
  type RetrieveMemoryInput,
  retrieveMemory,
} from '@/lib/memory/retrieval'
import { resolveActiveWorkspaceApplicationContext } from '@/lib/workspaces/application/workspace-context'

export const retrieveAgentMemoryUseCase = defineAuthorizedWorkspaceUseCase({
  operation: memoryOperations.retrieve,
  resolveContext: ({ input }: { input: RetrieveMemoryInput }) =>
    resolveActiveWorkspaceApplicationContext(input.workspaceId),
  authorizationOptions: { delegation: memoryDelegationPolicy },
  async execute({ input, context }) {
    const parsed = memoryRetrievalArgumentsSchema.safeParse(input.arguments)
    if (!parsed.success)
      throw new OrchestrationError('validation', 'Invalid memory retrieval arguments')
    return retrieveMemory({ ...input, workspaceId: context.workspaceId, arguments: parsed.data })
  },
})
