import { db } from '@sim/db'
import { workflow, workflowDeploymentVersion } from '@sim/db/schema'
import { createLogger } from '@sim/logger'
import { desc, eq } from 'drizzle-orm'
import { z } from 'zod'
import type { BaseServerTool } from '@/lib/copilot/tools/server/base-tool'
import { loadWorkflowFromNormalizedTables } from '@/lib/workflows/persistence/utils'

const logger = createLogger('RedeployServerTool')

export const RedeployInput = z.object({
  workflowId: z.string(),
})

export const RedeployResult = z.object({
  success: z.boolean(),
  workflowId: z.string(),
  deployedAt: z.string().nullable(),
  message: z.string(),
})

export type RedeployInputType = z.infer<typeof RedeployInput>
export type RedeployResultType = z.infer<typeof RedeployResult>

export const redeployServerTool: BaseServerTool<RedeployInputType, RedeployResultType> = {
  name: 'redeploy',
  async execute(args: unknown, _context?: { userId: string }) {
    const parsed = RedeployInput.parse(args)
    const { workflowId } = parsed

    logger.debug('Redeploying workflow', { workflowId })

    // Get workflow state
    const [wf] = await db.select().from(workflow).where(eq(workflow.id, workflowId)).limit(1)

    if (!wf) {
      throw new Error(`Workflow not found: ${workflowId}`)
    }

    // Get current max version
    const [maxVersion] = await db
      .select({ version: workflowDeploymentVersion.version })
      .from(workflowDeploymentVersion)
      .where(eq(workflowDeploymentVersion.workflowId, workflowId))
      .orderBy(desc(workflowDeploymentVersion.version))
      .limit(1)

    const newVersion = (maxVersion?.version || 0) + 1

    // Deactivate all existing versions
    await db
      .update(workflowDeploymentVersion)
      .set({ isActive: false })
      .where(eq(workflowDeploymentVersion.workflowId, workflowId))

    // Create new deployment version
    const deploymentId = crypto.randomUUID()
    const now = new Date()

    // Load workflow state from normalized tables
    const normalizedData = await loadWorkflowFromNormalizedTables(workflowId)
    const workflowState = {
      blocks: normalizedData?.blocks || {},
      edges: normalizedData?.edges || [],
      loops: normalizedData?.loops || {},
      parallels: normalizedData?.parallels || {},
    }

    await db.insert(workflowDeploymentVersion).values({
      id: deploymentId,
      workflowId,
      version: newVersion,
      state: workflowState,
      isActive: true,
      createdAt: now,
    })

    logger.info('Workflow redeployed', { workflowId, version: newVersion })

    return RedeployResult.parse({
      success: true,
      workflowId,
      deployedAt: now.toISOString(),
      message: `Workflow redeployed (version ${newVersion})`,
    })
  },
}
