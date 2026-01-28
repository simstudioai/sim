import { db } from '@sim/db'
import { workflow } from '@sim/db/schema'
import { createLogger } from '@sim/logger'
import { eq } from 'drizzle-orm'
import { z } from 'zod'
import type { BaseServerTool } from '@/lib/copilot/tools/server/base-tool'
import { loadWorkflowFromNormalizedTables } from '@/lib/workflows/persistence/utils'
import { sanitizeForCopilot } from '@/lib/workflows/sanitization/json-sanitizer'

const logger = createLogger('GetUserWorkflowServerTool')

export const GetUserWorkflowInput = z.object({
  workflowId: z.string().min(1),
})

export const GetUserWorkflowResult = z.object({
  userWorkflow: z.string(),
  workflowId: z.string(),
  workflowName: z.string(),
})

export type GetUserWorkflowInputType = z.infer<typeof GetUserWorkflowInput>
export type GetUserWorkflowResultType = z.infer<typeof GetUserWorkflowResult>

export const getUserWorkflowServerTool: BaseServerTool<
  GetUserWorkflowInputType,
  GetUserWorkflowResultType
> = {
  name: 'get_user_workflow',
  async execute(args: unknown, context?: { userId: string }) {
    const parsed = GetUserWorkflowInput.parse(args)
    const { workflowId } = parsed

    if (!context?.userId) {
      throw new Error('User authentication required')
    }

    logger.debug('Getting user workflow', { workflowId })

    // Get workflow metadata
    const [wf] = await db
      .select({ id: workflow.id, name: workflow.name, userId: workflow.userId })
      .from(workflow)
      .where(eq(workflow.id, workflowId))
      .limit(1)

    if (!wf) {
      throw new Error(`Workflow not found: ${workflowId}`)
    }

    // Load workflow from normalized tables
    const normalizedData = await loadWorkflowFromNormalizedTables(workflowId)

    if (!normalizedData?.blocks || Object.keys(normalizedData.blocks).length === 0) {
      throw new Error('Workflow state is empty or invalid')
    }

    // Build workflow state
    const workflowState = {
      blocks: normalizedData.blocks,
      edges: normalizedData.edges || [],
      loops: normalizedData.loops || {},
      parallels: normalizedData.parallels || {},
    }

    // Sanitize for copilot (remove UI-specific data)
    const sanitizedState = sanitizeForCopilot(workflowState as any)
    const userWorkflow = JSON.stringify(sanitizedState, null, 2)

    logger.info('Retrieved user workflow', {
      workflowId,
      workflowName: wf.name,
      blockCount: Object.keys(normalizedData.blocks).length,
    })

    return GetUserWorkflowResult.parse({
      userWorkflow,
      workflowId,
      workflowName: wf.name || 'Untitled',
    })
  },
}
