import crypto from 'crypto'
import { db } from '@sim/db'
import { chat, workflow, workflowMcpServer, workflowMcpTool } from '@sim/db/schema'
import { and, eq, inArray } from 'drizzle-orm'
import type { ExecutionContext, ToolCallResult } from '@/lib/copilot/orchestrator/types'
import { sanitizeToolName } from '@/lib/mcp/workflow-tool-schema'
import { deployWorkflow, undeployWorkflow } from '@/lib/workflows/persistence/utils'
import { hasValidStartBlock } from '@/lib/workflows/triggers/trigger-utils.server'
import { checkChatAccess, checkWorkflowAccessForChatCreation } from '@/app/api/chat/utils'
import { ensureWorkflowAccess } from './access'

export async function executeDeployApi(
  params: Record<string, any>,
  context: ExecutionContext
): Promise<ToolCallResult> {
  try {
    const workflowId = params.workflowId || context.workflowId
    if (!workflowId) {
      return { success: false, error: 'workflowId is required' }
    }
    const action = params.action === 'undeploy' ? 'undeploy' : 'deploy'
    const { workflow: workflowRecord } = await ensureWorkflowAccess(workflowId, context.userId)

    if (action === 'undeploy') {
      const result = await undeployWorkflow({ workflowId })
      if (!result.success) {
        return { success: false, error: result.error || 'Failed to undeploy workflow' }
      }
      return { success: true, output: { workflowId, isDeployed: false } }
    }

    const result = await deployWorkflow({
      workflowId,
      deployedBy: context.userId,
      workflowName: workflowRecord.name || undefined,
    })
    if (!result.success) {
      return { success: false, error: result.error || 'Failed to deploy workflow' }
    }

    return {
      success: true,
      output: {
        workflowId,
        isDeployed: true,
        deployedAt: result.deployedAt,
        version: result.version,
      },
    }
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : String(error) }
  }
}

export async function executeDeployChat(
  params: Record<string, any>,
  context: ExecutionContext
): Promise<ToolCallResult> {
  try {
    const workflowId = params.workflowId || context.workflowId
    if (!workflowId) {
      return { success: false, error: 'workflowId is required' }
    }

    const action = params.action === 'undeploy' ? 'undeploy' : 'deploy'
    if (action === 'undeploy') {
      const existing = await db.select().from(chat).where(eq(chat.workflowId, workflowId)).limit(1)
      if (!existing.length) {
        return { success: false, error: 'No active chat deployment found for this workflow' }
      }
      const { hasAccess } = await checkChatAccess(existing[0].id, context.userId)
      if (!hasAccess) {
        return { success: false, error: 'Unauthorized chat access' }
      }
      await db.delete(chat).where(eq(chat.id, existing[0].id))
      return { success: true, output: { success: true, action: 'undeploy', isDeployed: false } }
    }

    const { hasAccess } = await checkWorkflowAccessForChatCreation(workflowId, context.userId)
    if (!hasAccess) {
      return { success: false, error: 'Workflow not found or access denied' }
    }

    const existing = await db.select().from(chat).where(eq(chat.workflowId, workflowId)).limit(1)
    const existingDeployment = existing[0] || null

    const identifier = String(params.identifier || existingDeployment?.identifier || '').trim()
    const title = String(params.title || existingDeployment?.title || '').trim()
    if (!identifier || !title) {
      return { success: false, error: 'Chat identifier and title are required' }
    }

    const identifierPattern = /^[a-z0-9-]+$/
    if (!identifierPattern.test(identifier)) {
      return {
        success: false,
        error: 'Identifier can only contain lowercase letters, numbers, and hyphens',
      }
    }

    const existingIdentifier = await db
      .select()
      .from(chat)
      .where(eq(chat.identifier, identifier))
      .limit(1)
    if (existingIdentifier.length > 0 && existingIdentifier[0].id !== existingDeployment?.id) {
      return { success: false, error: 'Identifier already in use' }
    }

    const deployResult = await deployWorkflow({
      workflowId,
      deployedBy: context.userId,
    })
    if (!deployResult.success) {
      return { success: false, error: deployResult.error || 'Failed to deploy workflow' }
    }

    const payload = {
      workflowId,
      identifier,
      title,
      description: String(params.description || existingDeployment?.description || ''),
      customizations: {
        primaryColor:
          params.customizations?.primaryColor ||
          existingDeployment?.customizations?.primaryColor ||
          'var(--brand-primary-hover-hex)',
        welcomeMessage:
          params.customizations?.welcomeMessage ||
          existingDeployment?.customizations?.welcomeMessage ||
          'Hi there! How can I help you today?',
      },
      authType: params.authType || existingDeployment?.authType || 'public',
      password: params.password,
      allowedEmails: params.allowedEmails || existingDeployment?.allowedEmails || [],
      outputConfigs: params.outputConfigs || existingDeployment?.outputConfigs || [],
    }

    if (existingDeployment) {
      await db
        .update(chat)
        .set({
          identifier: payload.identifier,
          title: payload.title,
          description: payload.description,
          customizations: payload.customizations,
          authType: payload.authType,
          password: payload.password || existingDeployment.password,
          allowedEmails:
            payload.authType === 'email' || payload.authType === 'sso' ? payload.allowedEmails : [],
          outputConfigs: payload.outputConfigs,
          updatedAt: new Date(),
        })
        .where(eq(chat.id, existingDeployment.id))
    } else {
      await db.insert(chat).values({
        id: crypto.randomUUID(),
        workflowId,
        userId: context.userId,
        identifier: payload.identifier,
        title: payload.title,
        description: payload.description,
        customizations: payload.customizations,
        isActive: true,
        authType: payload.authType,
        password: payload.password || null,
        allowedEmails:
          payload.authType === 'email' || payload.authType === 'sso' ? payload.allowedEmails : [],
        outputConfigs: payload.outputConfigs,
        createdAt: new Date(),
        updatedAt: new Date(),
      })
    }

    return {
      success: true,
      output: { success: true, action: 'deploy', isDeployed: true, identifier },
    }
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : String(error) }
  }
}

export async function executeDeployMcp(
  params: Record<string, any>,
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

    if (!workflowRecord.isDeployed) {
      return {
        success: false,
        error: 'Workflow must be deployed before adding as an MCP tool. Use deploy_api first.',
      }
    }

    const serverId = params.serverId
    if (!serverId) {
      return {
        success: false,
        error: 'serverId is required. Use list_workspace_mcp_servers to get available servers.',
      }
    }

    const existingTool = await db
      .select()
      .from(workflowMcpTool)
      .where(and(eq(workflowMcpTool.serverId, serverId), eq(workflowMcpTool.workflowId, workflowId)))
      .limit(1)

    const toolName = sanitizeToolName(
      params.toolName || workflowRecord.name || `workflow_${workflowId}`
    )
    const toolDescription =
      params.toolDescription || workflowRecord.description || `Execute ${workflowRecord.name} workflow`
    const parameterSchema = params.parameterSchema || {}

    if (existingTool.length > 0) {
      const toolId = existingTool[0].id
      await db
        .update(workflowMcpTool)
        .set({
          toolName,
          toolDescription,
          parameterSchema,
          updatedAt: new Date(),
        })
        .where(eq(workflowMcpTool.id, toolId))
      return { success: true, output: { toolId, toolName, toolDescription, updated: true } }
    }

    const toolId = crypto.randomUUID()
    await db.insert(workflowMcpTool).values({
      id: toolId,
      serverId,
      workflowId,
      toolName,
      toolDescription,
      parameterSchema,
      createdAt: new Date(),
      updatedAt: new Date(),
    })

    return { success: true, output: { toolId, toolName, toolDescription, updated: false } }
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : String(error) }
  }
}

export async function executeRedeploy(context: ExecutionContext): Promise<ToolCallResult> {
  try {
    const workflowId = context.workflowId
    if (!workflowId) {
      return { success: false, error: 'workflowId is required' }
    }
    await ensureWorkflowAccess(workflowId, context.userId)

    const result = await deployWorkflow({ workflowId, deployedBy: context.userId })
    if (!result.success) {
      return { success: false, error: result.error || 'Failed to redeploy workflow' }
    }
    return {
      success: true,
      output: { workflowId, deployedAt: result.deployedAt || null, version: result.version },
    }
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : String(error) }
  }
}

export async function executeCheckDeploymentStatus(
  params: Record<string, any>,
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
      welcomeMessage: chatDeploy[0]?.customizations?.welcomeMessage || null,
      primaryColor: chatDeploy[0]?.customizations?.primaryColor || null,
      hasPassword: Boolean(chatDeploy[0]?.password),
    }

    const mcpDetails = { isDeployed: false, servers: [] as any[] }
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
  params: Record<string, any>,
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
  params: Record<string, any>,
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

