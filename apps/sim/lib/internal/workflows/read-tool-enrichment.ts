import {
  type BoundWorkflowExecutionPrincipal,
  requirePrincipalExecutionMetadata,
  resolvePrincipalSubject,
  type WorkflowExecutionPrincipal,
} from '@sim/auth/principal'
import { readWorkflowDefinitionAsExecutor } from '@/lib/internal/workflows/read-definition'
import { extractInputFieldsFromBlocks } from '@/lib/workflows/input-format'

export interface WorkflowToolEnrichmentContext {
  userId?: string
  workflowId?: string
  executionId?: string
  principal?: WorkflowExecutionPrincipal
}

async function readWorkflowForTool(workflowId: string, context: WorkflowToolEnrichmentContext) {
  const principal = context.principal
  if (!principal) throw new Error('Workflow enrichment requires trusted execution authority')
  requirePrincipalExecutionMetadata(principal)
  const runtimePrincipal = principal as BoundWorkflowExecutionPrincipal
  const subject = resolvePrincipalSubject(runtimePrincipal)
  if (!subject && runtimePrincipal.executionMetadata.currentWorkflow.mode !== 'deployment') {
    throw new Error('Actorless workflow enrichment requires deployed execution authority')
  }
  return readWorkflowDefinitionAsExecutor({
    principal: runtimePrincipal,
    workflowId,
    state: subject?.kind === 'sim_user' ? 'draft' : 'deployed',
  })
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
