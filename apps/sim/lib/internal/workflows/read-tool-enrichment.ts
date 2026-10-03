import { resolveExecutorOriginSubject } from '@/lib/internal/principals/executor'
import { readWorkflowDefinitionAsExecutor } from '@/lib/internal/workflows/read-definition'
import { extractInputFieldsFromBlocks } from '@/lib/workflows/input-format'
import type { ExecutorDelegationOrigin } from '@/executor/types'

export interface WorkflowToolEnrichmentContext {
  userId?: string
  workflowId?: string
  executionId?: string
  executorDelegationOrigin?: ExecutorDelegationOrigin
}

async function readWorkflowForTool(workflowId: string, context: WorkflowToolEnrichmentContext) {
  const origin = context.executorDelegationOrigin
  if (!origin) {
    throw new Error('Workflow enrichment requires trusted execution authority')
  }
  const subjectUserId = resolveExecutorOriginSubject(origin)
  if (subjectUserId) {
    return readWorkflowDefinitionAsExecutor({
      origin: { subjectUserId, workflowId },
      workflowId,
      state: 'draft',
    })
  }
  if (origin.currentWorkflow?.mode !== 'deployment') {
    throw new Error('Actorless workflow enrichment requires deployed execution authority')
  }
  return readWorkflowDefinitionAsExecutor({ origin, workflowId, state: 'deployed' })
}

export async function readWorkflowMetadataForTool(
  workflowId: string,
  context: WorkflowToolEnrichmentContext
): Promise<{ name: string; description: string | null }> {
  const { workflow } = await readWorkflowForTool(workflowId, context)
  return {
    name: workflow.name || 'Workflow',
    description: workflow.description || null,
  }
}

export async function readWorkflowInputFieldsForTool(
  workflowId: string,
  context: WorkflowToolEnrichmentContext
): Promise<Array<{ name: string; type: string; description?: string }>> {
  const { state } = await readWorkflowForTool(workflowId, context)
  return extractInputFieldsFromBlocks(state?.blocks ?? {})
}
