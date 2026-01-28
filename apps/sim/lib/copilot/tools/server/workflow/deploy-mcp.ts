import { db } from '@sim/db'
import {
  workflow,
  workflowDeploymentVersion,
  workflowMcpServer,
  workflowMcpTool,
} from '@sim/db/schema'
import { createLogger } from '@sim/logger'
import { and, eq } from 'drizzle-orm'
import { z } from 'zod'
import type { BaseServerTool } from '@/lib/copilot/tools/server/base-tool'

const logger = createLogger('DeployMcpServerTool')

const ParameterDescriptionSchema = z.object({
  name: z.string(),
  description: z.string(),
})

export const DeployMcpInput = z.object({
  serverId: z.string().min(1),
  workflowId: z.string().min(1),
  toolName: z.string().optional(),
  toolDescription: z.string().optional(),
  parameterDescriptions: z.array(ParameterDescriptionSchema).optional(),
})

export const DeployMcpResult = z.object({
  success: z.boolean(),
  toolId: z.string().nullable(),
  toolName: z.string().nullable(),
  toolDescription: z.string().nullable(),
  serverId: z.string().nullable(),
  updated: z.boolean().optional(),
  message: z.string(),
  error: z.string().optional(),
})

export type DeployMcpInputType = z.infer<typeof DeployMcpInput>
export type DeployMcpResultType = z.infer<typeof DeployMcpResult>

export const deployMcpServerTool: BaseServerTool<DeployMcpInputType, DeployMcpResultType> = {
  name: 'deploy_mcp',
  async execute(args: unknown, context?: { userId: string }) {
    const parsed = DeployMcpInput.parse(args)
    const { serverId, workflowId, toolName, toolDescription, parameterDescriptions } = parsed

    if (!context?.userId) {
      throw new Error('User authentication required')
    }

    logger.debug('Deploy MCP', { serverId, workflowId })

    // Get workflow info
    const [wf] = await db.select().from(workflow).where(eq(workflow.id, workflowId)).limit(1)

    if (!wf) {
      throw new Error(`Workflow not found: ${workflowId}`)
    }

    // Check if server exists
    const [server] = await db
      .select()
      .from(workflowMcpServer)
      .where(eq(workflowMcpServer.id, serverId))
      .limit(1)

    if (!server) {
      throw new Error(
        'MCP server not found. Use list_workspace_mcp_servers to see available servers.'
      )
    }

    // Check if workflow is deployed as API
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

    if (!deployment) {
      throw new Error(
        'Workflow must be deployed before adding as an MCP tool. Use deploy_api first.'
      )
    }

    // Build parameter schema if provided
    let parameterSchema: Record<string, unknown> | null = null
    if (parameterDescriptions && parameterDescriptions.length > 0) {
      const properties: Record<string, { description: string }> = {}
      for (const param of parameterDescriptions) {
        properties[param.name] = { description: param.description }
      }
      parameterSchema = { properties }
    }

    const finalToolName = toolName?.trim() || wf.name || 'workflow'
    const finalToolDescription = toolDescription?.trim() || null

    // Check if tool already exists for this workflow on this server
    const [existingTool] = await db
      .select()
      .from(workflowMcpTool)
      .where(
        and(eq(workflowMcpTool.serverId, serverId), eq(workflowMcpTool.workflowId, workflowId))
      )
      .limit(1)

    const now = new Date()

    if (existingTool) {
      // Update existing tool
      await db
        .update(workflowMcpTool)
        .set({
          toolName: finalToolName,
          toolDescription: finalToolDescription,
          parameterSchema,
          updatedAt: now,
        })
        .where(eq(workflowMcpTool.id, existingTool.id))

      logger.info('Updated MCP tool', { toolId: existingTool.id, toolName: finalToolName })

      return DeployMcpResult.parse({
        success: true,
        toolId: existingTool.id,
        toolName: finalToolName,
        toolDescription: finalToolDescription,
        serverId,
        updated: true,
        message: `Workflow MCP tool updated to "${finalToolName}".`,
      })
    }

    // Create new tool
    const toolId = crypto.randomUUID()

    await db.insert(workflowMcpTool).values({
      id: toolId,
      serverId,
      workflowId,
      toolName: finalToolName,
      toolDescription: finalToolDescription,
      parameterSchema,
      createdAt: now,
      updatedAt: now,
    })

    logger.info('Created MCP tool', { toolId, toolName: finalToolName })

    return DeployMcpResult.parse({
      success: true,
      toolId,
      toolName: finalToolName,
      toolDescription: finalToolDescription,
      serverId,
      message: `Workflow deployed as MCP tool "${finalToolName}" to server.`,
    })
  },
}
