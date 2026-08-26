import { assertWorkflowMutable, WorkflowLockedError } from '@sim/platform-authz/workflow'
import { OrchestrationError } from '@/lib/core/orchestration/types'

/** Refuses a mutation against a locked workflow as the `423` every surface renders. */
export async function requireMutableWorkflow(workflowId: string): Promise<void> {
  try {
    await assertWorkflowMutable(workflowId)
  } catch (error) {
    if (error instanceof WorkflowLockedError) {
      throw new OrchestrationError('locked', error.message)
    }
    throw error
  }
}
