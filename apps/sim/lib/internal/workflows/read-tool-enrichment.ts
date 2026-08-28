import { readWorkflowDefinitionAsExecutor } from '@/lib/internal/workflows/read-definition'
import { extractInputFieldsFromBlocks } from '@/lib/workflows/input-format'

export interface WorkflowToolEnrichmentContext {
  userId?: string
  workflowId?: string
  executionId?: string
}

async function readDraftWorkflowForTool(
  workflowId: string,
  context: WorkflowToolEnrichmentContext
) {
  if (!context.userId) {
    throw new Error('Workflow enrichment requires a trusted execution subject')
  }

  return readWorkflowDefinitionAsExecutor({
    origin: {
      subjectUserId: context.userId,
      workflowId,
      ...(context.workflowId === workflowId && context.executionId
        ? { executionId: context.executionId }
        : {}),
    },
    workflowId,
    state: 'draft',
  })
}

export async function readWorkflowMetadataForTool(
  workflowId: string,
  context: WorkflowToolEnrichmentContext
): Promise<{ name: string; description: string | null }> {
  const { workflow } = await readDraftWorkflowForTool(workflowId, context)
  return {
    name: workflow.name || 'Workflow',
    description: workflow.description || null,
  }
}

export async function readWorkflowInputFieldsForTool(
  workflowId: string,
  context: WorkflowToolEnrichmentContext
): Promise<Array<{ name: string; type: string; description?: string }>> {
  const { state } = await readDraftWorkflowForTool(workflowId, context)
  return extractInputFieldsFromBlocks(state?.blocks ?? {})
}
