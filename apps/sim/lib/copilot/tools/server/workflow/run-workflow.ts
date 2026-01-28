import { db } from '@sim/db'
import { workflow, workflowDeploymentVersion } from '@sim/db/schema'
import { createLogger } from '@sim/logger'
import { and, eq } from 'drizzle-orm'
import { z } from 'zod'
import type { BaseServerTool } from '@/lib/copilot/tools/server/base-tool'

const logger = createLogger('RunWorkflowServerTool')

export const RunWorkflowInput = z.object({
  workflowId: z.string().min(1),
  workflow_input: z.record(z.any()).optional(),
})

export const RunWorkflowResult = z.object({
  success: z.boolean(),
  executionId: z.string().nullable(),
  executionStartTime: z.string().nullable(),
  output: z.any().nullable(),
  message: z.string(),
  error: z.string().optional(),
})

export type RunWorkflowInputType = z.infer<typeof RunWorkflowInput>
export type RunWorkflowResultType = z.infer<typeof RunWorkflowResult>

export const runWorkflowServerTool: BaseServerTool<RunWorkflowInputType, RunWorkflowResultType> = {
  name: 'run_workflow',
  async execute(args: unknown, context?: { userId: string }) {
    const parsed = RunWorkflowInput.parse(args)
    const { workflowId, workflow_input } = parsed

    if (!context?.userId) {
      throw new Error('User authentication required')
    }

    logger.debug('Running workflow', { workflowId, hasInput: !!workflow_input })

    // Get workflow info
    const [wf] = await db.select().from(workflow).where(eq(workflow.id, workflowId)).limit(1)

    if (!wf) {
      throw new Error(`Workflow not found: ${workflowId}`)
    }

    // Check if workflow is deployed
    const [deployment] = await db
      .select({ id: workflowDeploymentVersion.id })
      .from(workflowDeploymentVersion)
      .where(
        and(
          eq(workflowDeploymentVersion.workflowId, workflowId),
          eq(workflowDeploymentVersion.isActive, true)
        )
      )
      .limit(1)

    const executionId = crypto.randomUUID()
    const executionStartTime = new Date().toISOString()

    // If workflow is deployed, we can use the execute API
    // Otherwise we need to execute directly
    const appUrl = process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000'

    try {
      // Call the internal execution endpoint
      // Note: For server-side execution without a browser, we call the API directly
      const executeUrl = `${appUrl}/api/workflows/${workflowId}/execute`

      const response = await fetch(executeUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          // Use internal auth header
          'X-Internal-Auth': context.userId,
        },
        body: JSON.stringify({
          input: workflow_input || {},
          executionId,
        }),
      })

      if (!response.ok) {
        const errorText = await response.text().catch(() => '')
        throw new Error(errorText || `Execution failed with status ${response.status}`)
      }

      const result = await response.json()

      // Determine success from result
      const succeeded = result.success !== false
      const output = result.output || result.result || null

      if (succeeded) {
        logger.info('Workflow execution completed', { workflowId, executionId })

        return RunWorkflowResult.parse({
          success: true,
          executionId,
          executionStartTime,
          output,
          message: `Workflow execution completed. Started at: ${executionStartTime}`,
        })
      }
      const errorMessage = result.error || 'Workflow execution failed'
      logger.error('Workflow execution failed', { workflowId, error: errorMessage })

      return RunWorkflowResult.parse({
        success: false,
        executionId,
        executionStartTime,
        output: null,
        message: errorMessage,
        error: errorMessage,
      })
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error)
      logger.error('Workflow execution error', { workflowId, error: errorMessage })

      return RunWorkflowResult.parse({
        success: false,
        executionId,
        executionStartTime,
        output: null,
        message: errorMessage,
        error: errorMessage,
      })
    }
  },
}
