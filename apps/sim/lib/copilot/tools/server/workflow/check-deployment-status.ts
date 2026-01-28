import { db } from '@sim/db'
import {
  chat,
  workflow,
  workflowDeploymentVersion,
  workflowMcpServer,
  workflowMcpTool,
} from '@sim/db/schema'
import { createLogger } from '@sim/logger'
import { and, eq } from 'drizzle-orm'
import { z } from 'zod'
import type { BaseServerTool } from '@/lib/copilot/tools/server/base-tool'
import { env } from '@/lib/core/config/env'

const logger = createLogger('CheckDeploymentStatusServerTool')

export const CheckDeploymentStatusInput = z.object({
  workflowId: z.string(),
})

export const CheckDeploymentStatusResult = z.object({
  isDeployed: z.boolean(),
  deploymentTypes: z.array(z.string()),
  api: z.object({
    isDeployed: z.boolean(),
    deployedAt: z.string().nullable(),
    endpoint: z.string().nullable(),
  }),
  chat: z.object({
    isDeployed: z.boolean(),
    chatId: z.string().nullable(),
    identifier: z.string().nullable(),
    chatUrl: z.string().nullable(),
    title: z.string().nullable(),
  }),
  mcp: z.object({
    isDeployed: z.boolean(),
    servers: z.array(
      z.object({
        serverId: z.string(),
        serverName: z.string(),
        toolName: z.string(),
      })
    ),
  }),
  message: z.string(),
})

export type CheckDeploymentStatusInputType = z.infer<typeof CheckDeploymentStatusInput>
export type CheckDeploymentStatusResultType = z.infer<typeof CheckDeploymentStatusResult>

export const checkDeploymentStatusServerTool: BaseServerTool<
  CheckDeploymentStatusInputType,
  CheckDeploymentStatusResultType
> = {
  name: 'check_deployment_status',
  async execute(args: unknown, _context?: { userId: string }) {
    const parsed = CheckDeploymentStatusInput.parse(args)
    const { workflowId } = parsed

    logger.debug('Checking deployment status', { workflowId })

    // Get workflow to find workspaceId
    const [wf] = await db
      .select({ workspaceId: workflow.workspaceId })
      .from(workflow)
      .where(eq(workflow.id, workflowId))
      .limit(1)

    const workspaceId = wf?.workspaceId

    // Check API deployment (active deployment version)
    const [apiDeploy] = await db
      .select({
        id: workflowDeploymentVersion.id,
        createdAt: workflowDeploymentVersion.createdAt,
      })
      .from(workflowDeploymentVersion)
      .where(
        and(
          eq(workflowDeploymentVersion.workflowId, workflowId),
          eq(workflowDeploymentVersion.isActive, true)
        )
      )
      .limit(1)

    const isApiDeployed = !!apiDeploy
    const appUrl = env.NEXT_PUBLIC_APP_URL || 'https://simstudio.ai'

    // Check chat deployment
    const [chatDeploy] = await db
      .select({
        id: chat.id,
        identifier: chat.identifier,
        title: chat.title,
      })
      .from(chat)
      .where(eq(chat.workflowId, workflowId))
      .limit(1)

    const isChatDeployed = !!chatDeploy

    // Check MCP deployment
    let mcpToolDeployments: { serverId: string; serverName: string; toolName: string }[] = []
    if (workspaceId) {
      const mcpTools = await db
        .select({
          toolName: workflowMcpTool.toolName,
          serverId: workflowMcpTool.serverId,
          serverName: workflowMcpServer.name,
        })
        .from(workflowMcpTool)
        .innerJoin(workflowMcpServer, eq(workflowMcpTool.serverId, workflowMcpServer.id))
        .where(eq(workflowMcpTool.workflowId, workflowId))

      mcpToolDeployments = mcpTools.map((t) => ({
        serverId: t.serverId,
        serverName: t.serverName,
        toolName: t.toolName,
      }))
    }

    const isMcpDeployed = mcpToolDeployments.length > 0

    // Build result
    const deploymentTypes: string[] = []
    if (isApiDeployed) deploymentTypes.push('api')
    if (isChatDeployed) deploymentTypes.push('chat')
    if (isMcpDeployed) deploymentTypes.push('mcp')

    const isDeployed = isApiDeployed || isChatDeployed || isMcpDeployed

    // Build summary message
    let message = ''
    if (!isDeployed) {
      message = 'Workflow is not deployed'
    } else {
      const parts: string[] = []
      if (isApiDeployed) parts.push('API')
      if (isChatDeployed) parts.push(`Chat (${chatDeploy?.identifier})`)
      if (isMcpDeployed) {
        const serverNames = [...new Set(mcpToolDeployments.map((d) => d.serverName))].join(', ')
        parts.push(`MCP (${serverNames})`)
      }
      message = `Workflow is deployed as: ${parts.join(', ')}`
    }

    logger.info('Checked deployment status', { workflowId, isDeployed, deploymentTypes })

    return CheckDeploymentStatusResult.parse({
      isDeployed,
      deploymentTypes,
      api: {
        isDeployed: isApiDeployed,
        deployedAt: apiDeploy?.createdAt?.toISOString() || null,
        endpoint: isApiDeployed ? `${appUrl}/api/workflows/${workflowId}/execute` : null,
      },
      chat: {
        isDeployed: isChatDeployed,
        chatId: chatDeploy?.id || null,
        identifier: chatDeploy?.identifier || null,
        chatUrl: isChatDeployed ? `${appUrl}/chat/${chatDeploy?.identifier}` : null,
        title: chatDeploy?.title || null,
      },
      mcp: {
        isDeployed: isMcpDeployed,
        servers: mcpToolDeployments,
      },
      message,
    })
  },
}
