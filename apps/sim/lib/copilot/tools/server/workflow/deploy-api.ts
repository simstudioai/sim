import { db } from '@sim/db'
import { apiKey, workflow, workflowDeploymentVersion } from '@sim/db/schema'
import { createLogger } from '@sim/logger'
import { desc, eq, or } from 'drizzle-orm'
import { z } from 'zod'
import type { BaseServerTool } from '@/lib/copilot/tools/server/base-tool'
import { loadWorkflowFromNormalizedTables } from '@/lib/workflows/persistence/utils'

const logger = createLogger('DeployApiServerTool')

export const DeployApiInput = z.object({
  action: z.enum(['deploy', 'undeploy']).default('deploy'),
  workflowId: z.string().min(1),
})

export const DeployApiResult = z.object({
  success: z.boolean(),
  action: z.string(),
  isDeployed: z.boolean(),
  deployedAt: z.string().nullable(),
  endpoint: z.string().nullable(),
  curlCommand: z.string().nullable(),
  message: z.string(),
  needsApiKey: z.boolean().optional(),
})

export type DeployApiInputType = z.infer<typeof DeployApiInput>
export type DeployApiResultType = z.infer<typeof DeployApiResult>

export const deployApiServerTool: BaseServerTool<DeployApiInputType, DeployApiResultType> = {
  name: 'deploy_api',
  async execute(args: unknown, context?: { userId: string }) {
    const parsed = DeployApiInput.parse(args)
    const { action, workflowId } = parsed

    if (!context?.userId) {
      throw new Error('User authentication required')
    }

    logger.debug('Deploy API', { action, workflowId })

    // Get workflow info
    const [wf] = await db.select().from(workflow).where(eq(workflow.id, workflowId)).limit(1)

    if (!wf) {
      throw new Error(`Workflow not found: ${workflowId}`)
    }

    const workspaceId = wf.workspaceId

    if (action === 'undeploy') {
      // Deactivate all deployment versions
      await db
        .update(workflowDeploymentVersion)
        .set({ isActive: false })
        .where(eq(workflowDeploymentVersion.workflowId, workflowId))

      logger.info('Workflow undeployed', { workflowId })

      return DeployApiResult.parse({
        success: true,
        action: 'undeploy',
        isDeployed: false,
        deployedAt: null,
        endpoint: null,
        curlCommand: null,
        message: 'Workflow undeployed successfully.',
      })
    }

    // Deploy action - check if user has API keys
    const keys = await db
      .select({ id: apiKey.id })
      .from(apiKey)
      .where(
        or(
          eq(apiKey.userId, context.userId),
          workspaceId ? eq(apiKey.workspaceId, workspaceId) : undefined
        )
      )
      .limit(1)

    if (keys.length === 0) {
      return DeployApiResult.parse({
        success: false,
        action: 'deploy',
        isDeployed: false,
        deployedAt: null,
        endpoint: null,
        curlCommand: null,
        message:
          'Cannot deploy without an API key. Please create an API key in settings first, then try deploying again.',
        needsApiKey: true,
      })
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

    // Build API info
    const appUrl = process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000'
    const apiEndpoint = `${appUrl}/api/workflows/${workflowId}/execute`
    const curlCommand = `curl -X POST -H "X-API-Key: $SIM_API_KEY" -H "Content-Type: application/json" ${apiEndpoint}`

    logger.info('Workflow deployed as API', { workflowId, version: newVersion })

    return DeployApiResult.parse({
      success: true,
      action: 'deploy',
      isDeployed: true,
      deployedAt: now.toISOString(),
      endpoint: apiEndpoint,
      curlCommand,
      message: 'Workflow deployed successfully as API. You can now call it via REST.',
    })
  },
}
