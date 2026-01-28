import { db } from '@sim/db'
import { workflow } from '@sim/db/schema'
import { createLogger } from '@sim/logger'
import { and, eq, ilike } from 'drizzle-orm'
import { z } from 'zod'
import type { BaseServerTool } from '@/lib/copilot/tools/server/base-tool'
import { loadWorkflowFromNormalizedTables } from '@/lib/workflows/persistence/utils'
import { sanitizeForCopilot } from '@/lib/workflows/sanitization/json-sanitizer'

const logger = createLogger('GetWorkflowFromNameServerTool')

export const GetWorkflowFromNameInput = z.object({
  workflow_name: z.string().min(1),
})

export const GetWorkflowFromNameResult = z.object({
  userWorkflow: z.string(),
  workflowId: z.string(),
  workflowName: z.string(),
})

export type GetWorkflowFromNameInputType = z.infer<typeof GetWorkflowFromNameInput>
export type GetWorkflowFromNameResultType = z.infer<typeof GetWorkflowFromNameResult>

export const getWorkflowFromNameServerTool: BaseServerTool<
  GetWorkflowFromNameInputType,
  GetWorkflowFromNameResultType
> = {
  name: 'get_workflow_from_name',
  async execute(args: unknown, context?: { userId: string }) {
    const parsed = GetWorkflowFromNameInput.parse(args)
    const workflowName = parsed.workflow_name.trim()

    logger.debug('Executing get_workflow_from_name', {
      workflowName,
      userId: context?.userId,
    })

    if (!context?.userId) {
      throw new Error('User ID is required')
    }

    // Find workflow by name (case-insensitive)
    const workflows = await db
      .select({ id: workflow.id, name: workflow.name })
      .from(workflow)
      .where(and(eq(workflow.userId, context.userId), ilike(workflow.name, workflowName)))
      .limit(1)

    if (workflows.length === 0) {
      throw new Error(`Workflow not found: ${workflowName}`)
    }

    const wf = workflows[0]

    // Load workflow from normalized tables
    const normalizedData = await loadWorkflowFromNormalizedTables(wf.id)

    if (!normalizedData?.blocks || Object.keys(normalizedData.blocks).length === 0) {
      throw new Error('Workflow state is empty or invalid')
    }

    // Build workflow state from normalized data
    const workflowState = {
      blocks: normalizedData.blocks,
      edges: normalizedData.edges || [],
      loops: normalizedData.loops || {},
      parallels: normalizedData.parallels || {},
    }

    // Sanitize for copilot
    const sanitizedState = sanitizeForCopilot(workflowState as any)
    const userWorkflow = JSON.stringify(sanitizedState, null, 2)

    logger.info('Retrieved workflow by name', {
      workflowId: wf.id,
      workflowName: wf.name,
    })

    return GetWorkflowFromNameResult.parse({
      userWorkflow,
      workflowId: wf.id,
      workflowName: wf.name || workflowName,
    })
  },
}
