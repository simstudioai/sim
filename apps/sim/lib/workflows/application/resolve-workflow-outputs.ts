import { defineAuthorizedWorkflowUseCase } from '@/lib/workflows/application/authorized-workflow-use-case'
import {
  type ActiveWorkflowApplicationContext,
  resolveActiveWorkflowApplicationContext,
} from '@/lib/workflows/application/context'
import { workflowOperations } from '@/lib/workflows/application/operations'
import {
  type FlattenedBlockOutput,
  flattenWorkflowOutputs,
  getBlockExecutionOrder,
} from '@/lib/workflows/blocks/flatten-outputs'
import { loadWorkflowFromNormalizedTables } from '@/lib/workflows/persistence/utils'

export interface ResolveWorkflowOutputsInput {
  workflowId: string
  assertedWorkspaceId: string
}

export interface ResolveWorkflowOutputsResult {
  workflowId: string
  outputs: FlattenedBlockOutput[] | null
  executionOrderByBlockId: Record<string, number>
}

/** Loads output metadata after a top-level application command has authorized this workflow context. */
export async function loadResolvedWorkflowOutputs(
  context: ActiveWorkflowApplicationContext
): Promise<ResolveWorkflowOutputsResult> {
  const normalized = await loadWorkflowFromNormalizedTables(context.workflowId)
  if (!normalized) {
    return { workflowId: context.workflowId, outputs: null, executionOrderByBlockId: {} }
  }
  const blocks = Object.values(normalized.blocks ?? {}).map((block) => ({
    id: block.id,
    type: block.type,
    name: block.name,
    triggerMode: (block as { triggerMode?: boolean }).triggerMode,
    subBlocks: block.subBlocks as Record<string, unknown> | undefined,
  }))
  return {
    workflowId: context.workflowId,
    outputs: flattenWorkflowOutputs(blocks, normalized.edges ?? []),
    executionOrderByBlockId: getBlockExecutionOrder(blocks, normalized.edges ?? []),
  }
}

export const resolveWorkflowOutputs = defineAuthorizedWorkflowUseCase({
  operation: workflowOperations.read,
  resolveContext: ({ input }: { input: ResolveWorkflowOutputsInput }) =>
    resolveActiveWorkflowApplicationContext({
      workflowId: input.workflowId,
      assertedWorkspaceId: input.assertedWorkspaceId,
    }),
  async execute({ context }): Promise<ResolveWorkflowOutputsResult> {
    return loadResolvedWorkflowOutputs(context)
  },
})
