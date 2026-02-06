import crypto from 'crypto'
import { db } from '@sim/db'
import { chat, workflow, workflowMcpServer, workflowMcpTool } from '@sim/db/schema'
import { eq, inArray } from 'drizzle-orm'
import type { ExecutionContext, ToolCallResult } from '@/lib/copilot/orchestrator/types'
import { sanitizeToolName } from '@/lib/mcp/workflow-tool-schema'
import { hasValidStartBlock } from '@/lib/workflows/triggers/trigger-utils.server'
import { ensureWorkflowAccess } from '../access'
import type {
  CheckDeploymentStatusParams,
  CreateWorkspaceMcpServerParams,
  ListWorkspaceMcpServersParams,
} from '../param-types'

export async function executeCheckDeploymentStatus(
  params: CheckDeploymentStatusParams,
  context: ExecutionContext
): Promise<ToolCallResult> {
  try {
    const workflowId = params.workflowId || context.workflowId
    if (!workflowId) {
      return { success: false, error: 'workflowId is required' }
    }
    const { workflow: workflowRecord } = await ensureWorkflowAccess(workflowId, context.userId)
    const workspaceId = workflowRecord.workspaceId

    const [apiDeploy, chatDeploy] = await Promise.all([
      db.select().from(workflow).where(eq(workflow.id, workflowId)).limit(1),
      db.select().from(chat).where(eq(chat.workflowId, workflowId)).limit(1),
    ])

    const isApiDeployed = apiDeploy[0]?.isDeployed || false
    const apiDetails = {
      isDeployed: isApiDeployed,
      deployedAt: apiDeploy[0]?.deployedAt || null,
      endpoint: isApiDeployed ? `/api/workflows/${workflowId}/execute` : null,
      apiKey: workflowRecord.workspaceId ? 'Workspace API keys' : 'Personal API keys',
      needsRedeployment: false,
    }

    const isChatDeployed = !!chatDeploy[0]
    const chatCustomizations =
      (chatDeploy[0]?.customizations as
        | { welcomeMessage?: string; primaryColor?: string }
        | undefined) || {}
    const chatDetails = {
      isDeployed: isChatDeployed,
      chatId: chatDeploy[0]?.id || null,
      identifier: chatDeploy[0]?.identifier || null,
      chatUrl: isChatDeployed ? `/chat/${chatDeploy[0]?.identifier}` : null,
      title: chatDeploy[0]?.title || null,
      description: chatDeploy[0]?.description || null,
      authType: chatDeploy[0]?.authType || null,
      allowedEmails: chatDeploy[0]?.allowedEmails || null,
      outputConfigs: chatDeploy[0]?.outputConfigs || null,
      welcomeMessage: chatCustomizations.welcomeMessage || null,
      primaryColor: chatCustomizations.primaryColor || null,
      hasPassword: Boolean(chatDeploy[0]?.password),
    }

    const mcpDetails: {
      isDeployed: boolean
      servers: Array<{
        serverId: string
        serverName: string
        toolName: string
        toolDescription: string | null
        parameterSchema: unknown
        toolId: string
      }>
    } = { isDeployed: false, servers: [] }
    if (workspaceId) {
      const servers = await db
        .select({
          serverId: workflowMcpServer.id,
          serverName: workflowMcpServer.name,
          toolName: workflowMcpTool.toolName,
          toolDescription: workflowMcpTool.toolDescription,
          parameterSchema: workflowMcpTool.parameterSchema,
          toolId: workflowMcpTool.id,
        })
        .from(workflowMcpTool)
        .innerJoin(workflowMcpServer, eq(workflowMcpTool.serverId, workflowMcpServer.id))
        .where(eq(workflowMcpTool.workflowId, workflowId))

      if (servers.length > 0) {
        mcpDetails.isDeployed = true
        mcpDetails.servers = servers
      }
    }

    const isDeployed = apiDetails.isDeployed || chatDetails.isDeployed || mcpDetails.isDeployed
    return {
      success: true,
      output: { isDeployed, api: apiDetails, chat: chatDetails, mcp: mcpDetails },
    }
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : String(error) }
  }
}

export async function executeListWorkspaceMcpServers(
  params: ListWorkspaceMcpServersParams,
  context: ExecutionContext
): Promise<ToolCallResult> {
  try {
    const workflowId = params.workflowId || context.workflowId
    if (!workflowId) {
      return { success: false, error: 'workflowId is required' }
    }
    const { workflow: workflowRecord } = await ensureWorkflowAccess(workflowId, context.userId)
    const workspaceId = workflowRecord.workspaceId
    if (!workspaceId) {
      return { success: false, error: 'workspaceId is required' }
    }

    const servers = await db
      .select({
        id: workflowMcpServer.id,
        name: workflowMcpServer.name,
        description: workflowMcpServer.description,
      })
      .from(workflowMcpServer)
      .where(eq(workflowMcpServer.workspaceId, workspaceId))

    const serverIds = servers.map((server) => server.id)
    const tools =
      serverIds.length > 0
        ? await db
            .select({
              serverId: workflowMcpTool.serverId,
              toolName: workflowMcpTool.toolName,
            })
            .from(workflowMcpTool)
            .where(inArray(workflowMcpTool.serverId, serverIds))
        : []

    const toolNamesByServer: Record<string, string[]> = {}
    for (const tool of tools) {
      if (!toolNamesByServer[tool.serverId]) {
        toolNamesByServer[tool.serverId] = []
      }
      toolNamesByServer[tool.serverId].push(tool.toolName)
    }

    const serversWithToolNames = servers.map((server) => ({
      ...server,
      toolCount: toolNamesByServer[server.id]?.length || 0,
      toolNames: toolNamesByServer[server.id] || [],
    }))

    return { success: true, output: { servers: serversWithToolNames, count: servers.length } }
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : String(error) }
  }
}

export async function executeCreateWorkspaceMcpServer(
  params: CreateWorkspaceMcpServerParams,
  context: ExecutionContext
): Promise<ToolCallResult> {
  try {
    const workflowId = params.workflowId || context.workflowId
    if (!workflowId) {
      return { success: false, error: 'workflowId is required' }
    }
    const { workflow: workflowRecord } = await ensureWorkflowAccess(workflowId, context.userId)
    const workspaceId = workflowRecord.workspaceId
    if (!workspaceId) {
      return { success: false, error: 'workspaceId is required' }
    }

    const name = params.name?.trim()
    if (!name) {
      return { success: false, error: 'name is required' }
    }

    const serverId = crypto.randomUUID()
    const [server] = await db
      .insert(workflowMcpServer)
      .values({
        id: serverId,
        workspaceId,
        createdBy: context.userId,
        name,
        description: params.description?.trim() || null,
        isPublic: params.isPublic ?? false,
        createdAt: new Date(),
        updatedAt: new Date(),
      })
      .returning()

    const workflowIds: string[] = params.workflowIds || []
    const addedTools: Array<{ workflowId: string; toolName: string }> = []

    if (workflowIds.length > 0) {
      const workflows = await db.select().from(workflow).where(inArray(workflow.id, workflowIds))

      for (const wf of workflows) {
        if (wf.workspaceId !== workspaceId || !wf.isDeployed) {
          continue
        }
        const hasStartBlock = await hasValidStartBlock(wf.id)
        if (!hasStartBlock) {
          continue
        }
        const toolName = sanitizeToolName(wf.name || `workflow_${wf.id}`)
        await db.insert(workflowMcpTool).values({
          id: crypto.randomUUID(),
          serverId,
          workflowId: wf.id,
          toolName,
          toolDescription: wf.description || `Execute ${wf.name} workflow`,
          parameterSchema: {},
          createdAt: new Date(),
          updatedAt: new Date(),
        })
        addedTools.push({ workflowId: wf.id, toolName })
      }
    }

    return { success: true, output: { server, addedTools } }
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : String(error) }
  }
}
