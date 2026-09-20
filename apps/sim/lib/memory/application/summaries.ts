import { defineAuthorizedWorkspaceUseCase } from '@/lib/core/application'
import { memoryDelegationPolicy } from '@/lib/memory/application/authorization'
import { memoryOperations } from '@/lib/memory/application/operations'
import {
  type MemorySummaryScope,
  readMemorySummary,
  type SaveMemorySummaryInput,
  saveMemorySummary,
} from '@/lib/memory/summary-store'
import { resolveActiveWorkspaceApplicationContext } from '@/lib/workspaces/application/workspace-context'

export const readAgentMemorySummaryUseCase = defineAuthorizedWorkspaceUseCase({
  operation: memoryOperations.readSummary,
  resolveContext: ({ input }: { input: MemorySummaryScope }) =>
    resolveActiveWorkspaceApplicationContext(input.workspaceId),
  authorizationOptions: { delegation: memoryDelegationPolicy },
  execute: ({ input, context }) =>
    readMemorySummary({ ...input, workspaceId: context.workspaceId }),
})

export const saveAgentMemorySummaryUseCase = defineAuthorizedWorkspaceUseCase({
  operation: memoryOperations.saveSummary,
  resolveContext: ({ input }: { input: SaveMemorySummaryInput }) =>
    resolveActiveWorkspaceApplicationContext(input.workspaceId),
  authorizationOptions: { delegation: memoryDelegationPolicy },
  execute: ({ input, context }) =>
    saveMemorySummary({ ...input, workspaceId: context.workspaceId }),
})
