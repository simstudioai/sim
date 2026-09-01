import { OrchestrationError } from '@/lib/core/orchestration/types'
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
import {
  loadDeployedWorkflowState,
  loadWorkflowFromNormalizedTables,
  NoActiveDeploymentError,
} from '@/lib/workflows/persistence/utils'

export interface ResolveWorkflowOutputsInput {
  workflowId: string
  assertedWorkspaceId: string
}

export interface ResolveWorkflowOutputsResult {
  workflowId: string
  outputs: FlattenedBlockOutput[] | null
  executionOrderByBlockId: Record<string, number>
}

type ResolvableWorkflowState =
  | NonNullable<Awaited<ReturnType<typeof loadWorkflowFromNormalizedTables>>>
  | Awaited<ReturnType<typeof loadDeployedWorkflowState>>

function resolveWorkflowOutputsFromState(
  workflowId: string,
  normalized: ResolvableWorkflowState
): ResolveWorkflowOutputsResult {
  const blocks = Object.values(normalized.blocks ?? {}).map((block) => ({
    id: block.id,
    type: block.type,
    name: block.name,
    triggerMode: (block as { triggerMode?: boolean }).triggerMode,
    subBlocks: block.subBlocks as Record<string, unknown> | undefined,
  }))
  return {
    workflowId,
    outputs: flattenWorkflowOutputs(blocks, normalized.edges ?? []),
    executionOrderByBlockId: getBlockExecutionOrder(blocks, normalized.edges ?? []),
  }
}

/** Loads output metadata after a top-level application command has authorized this workflow context. */
export async function loadResolvedWorkflowOutputs(
  context: ActiveWorkflowApplicationContext
): Promise<ResolveWorkflowOutputsResult> {
  const normalized = await loadWorkflowFromNormalizedTables(context.workflowId)
  if (!normalized) {
    return { workflowId: context.workflowId, outputs: null, executionOrderByBlockId: {} }
  }
  return resolveWorkflowOutputsFromState(context.workflowId, normalized)
}

/** Loads output metadata from the active deployment after workflow authorization. */
export async function loadResolvedDeployedWorkflowOutputs(
  context: ActiveWorkflowApplicationContext
): Promise<ResolveWorkflowOutputsResult> {
  if (!context.workflow.isDeployed) {
    throw new OrchestrationError('validation', 'Workflow must have an active deployment')
  }
  try {
    const normalized = await loadDeployedWorkflowState(context.workflowId, context.workspaceId)
    return resolveWorkflowOutputsFromState(context.workflowId, normalized)
  } catch (error) {
    if (error instanceof NoActiveDeploymentError) {
      throw new OrchestrationError('validation', 'Workflow must have an active deployment')
    }
    throw error
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
