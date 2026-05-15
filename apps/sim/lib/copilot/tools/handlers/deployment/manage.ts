import { db } from '@sim/db'
import {
  chat,
  workflow,
  workflowDeploymentVersion,
  workflowMcpServer,
  workflowMcpTool,
} from '@sim/db/schema'
import { toError } from '@sim/utils/errors'
import { and, eq, inArray, isNull } from 'drizzle-orm'
import type { ExecutionContext, ToolCallResult } from '@/lib/copilot/request/types'
import {
  performCreateWorkflowMcpServer,
  performDeleteWorkflowMcpServer,
  performUpdateWorkflowMcpServer,
} from '@/lib/mcp/orchestration'
import { performRevertToVersion } from '@/lib/workflows/orchestration'
import { ensureWorkflowAccess, ensureWorkspaceAccess } from '../access'
import type {
  CheckDeploymentStatusParams,
  CreateWorkspaceMcpServerParams,
  DeleteWorkspaceMcpServerParams,
  ListWorkspaceMcpServersParams,
  UpdateWorkspaceMcpServerParams,
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
      db
        .select()
        .from(chat)
        .where(and(eq(chat.workflowId, workflowId), isNull(chat.archivedAt)))
        .limit(1),
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
    return { success: false, error: toError(error).message }
  }
}

export async function executeListWorkspaceMcpServers(
  params: ListWorkspaceMcpServersParams,
  context: ExecutionContext
): Promise<ToolCallResult> {
  try {
    let workspaceId = params.workspaceId || context.workspaceId
    const workflowId = context.workflowId

    if (!workspaceId && workflowId) {
      const { workflow: workflowRecord } = await ensureWorkflowAccess(workflowId, context.userId)
      workspaceId = workflowRecord.workspaceId ?? undefined
    }

    if (!workspaceId) {
      return { success: false, error: 'workspaceId is required' }
    }
    await ensureWorkspaceAccess(workspaceId, context.userId, 'read')

    const servers = await db
      .select({
        id: workflowMcpServer.id,
        name: workflowMcpServer.name,
        description: workflowMcpServer.description,
      })
      .from(workflowMcpServer)
      .where(
        and(eq(workflowMcpServer.workspaceId, workspaceId), isNull(workflowMcpServer.deletedAt))
      )

    const serverIds = servers.map((server) => server.id)
    const tools =
      serverIds.length > 0
        ? await db
            .select({
              serverId: workflowMcpTool.serverId,
              toolName: workflowMcpTool.toolName,
            })
            .from(workflowMcpTool)
            .where(
              and(inArray(workflowMcpTool.serverId, serverIds), isNull(workflowMcpTool.archivedAt))
            )
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
    return { success: false, error: toError(error).message }
  }
}

export async function executeCreateWorkspaceMcpServer(
  params: CreateWorkspaceMcpServerParams,
  context: ExecutionContext
): Promise<ToolCallResult> {
  try {
    let workspaceId = params.workspaceId || context.workspaceId
    const workflowId = context.workflowId

    if (!workspaceId && workflowId) {
      const { workflow: workflowRecord } = await ensureWorkflowAccess(
        workflowId,
        context.userId,
        'write'
      )
      workspaceId = workflowRecord.workspaceId ?? undefined
    }

    if (!workspaceId) {
      return { success: false, error: 'workspaceId is required' }
    }
    await ensureWorkspaceAccess(workspaceId, context.userId, 'admin')

    const name = params.name?.trim()
    if (!name) {
      return { success: false, error: 'name is required' }
    }

    const result = await performCreateWorkflowMcpServer({
      workspaceId,
      userId: context.userId,
      name,
      description: params.description,
      isPublic: params.isPublic,
      workflowIds: params.workflowIds,
    })
    if (!result.success) {
      return { success: false, error: result.error || 'Failed to create MCP server' }
    }

    return { success: true, output: { server: result.server, addedTools: result.addedTools || [] } }
  } catch (error) {
    return { success: false, error: toError(error).message }
  }
}

export async function executeUpdateWorkspaceMcpServer(
  params: UpdateWorkspaceMcpServerParams,
  context: ExecutionContext
): Promise<ToolCallResult> {
  try {
    const serverId = params.serverId
    if (!serverId) {
      return { success: false, error: 'serverId is required' }
    }

    const updates: { name?: string; description?: string | null; isPublic?: boolean } = {}
    if (typeof params.name === 'string') {
      const name = params.name.trim()
      if (!name) return { success: false, error: 'name cannot be empty' }
      updates.name = name
    }
    if (typeof params.description === 'string') {
      updates.description = params.description.trim() || null
    }
    if (typeof params.isPublic === 'boolean') {
      updates.isPublic = params.isPublic
    }

    if (Object.keys(updates).length === 0) {
      return { success: false, error: 'At least one of name, description, or isPublic is required' }
    }

    const [existing] = await db
      .select({
        id: workflowMcpServer.id,
        workspaceId: workflowMcpServer.workspaceId,
      })
      .from(workflowMcpServer)
      .where(eq(workflowMcpServer.id, serverId))
      .limit(1)

    if (!existing) {
      return { success: false, error: 'MCP server not found' }
    }

    await ensureWorkspaceAccess(existing.workspaceId, context.userId, 'write')

    const result = await performUpdateWorkflowMcpServer({
      serverId,
      workspaceId: existing.workspaceId,
      userId: context.userId,
      ...updates,
    })
    if (!result.success) {
      return { success: false, error: result.error || 'Failed to update MCP server' }
    }

    return { success: true, output: { serverId, ...updates } }
  } catch (error) {
    return { success: false, error: toError(error).message }
  }
}

export async function executeDeleteWorkspaceMcpServer(
  params: DeleteWorkspaceMcpServerParams,
  context: ExecutionContext
): Promise<ToolCallResult> {
  try {
    const serverId = params.serverId
    if (!serverId) {
      return { success: false, error: 'serverId is required' }
    }

    const [existing] = await db
      .select({
        id: workflowMcpServer.id,
        name: workflowMcpServer.name,
        workspaceId: workflowMcpServer.workspaceId,
      })
      .from(workflowMcpServer)
      .where(and(eq(workflowMcpServer.id, serverId), isNull(workflowMcpServer.deletedAt)))
      .limit(1)

    if (!existing) {
      return { success: false, error: 'MCP server not found' }
    }

    await ensureWorkspaceAccess(existing.workspaceId, context.userId, 'admin')

    const result = await performDeleteWorkflowMcpServer({
      serverId,
      workspaceId: existing.workspaceId,
      userId: context.userId,
    })
    if (!result.success) {
      return { success: false, error: result.error || 'Failed to delete MCP server' }
    }

    return { success: true, output: { serverId, name: existing.name, deleted: true } }
  } catch (error) {
    return { success: false, error: toError(error).message }
  }
}

export async function executeGetDeploymentVersion(
  params: { workflowId?: string; version?: number },
  context: ExecutionContext
): Promise<ToolCallResult> {
  try {
    const workflowId = params.workflowId || context.workflowId
    if (!workflowId) {
      return { success: false, error: 'workflowId is required' }
    }
    const version = params.version
    if (version === undefined || version === null) {
      return { success: false, error: 'version is required' }
    }

    await ensureWorkflowAccess(workflowId, context.userId)

    const [row] = await db
      .select({ state: workflowDeploymentVersion.state })
      .from(workflowDeploymentVersion)
      .where(
        and(
          eq(workflowDeploymentVersion.workflowId, workflowId),
          eq(workflowDeploymentVersion.version, version)
        )
      )
      .limit(1)

    if (!row?.state) {
      return { success: false, error: `Deployment version ${version} not found` }
    }

    return { success: true, output: { version, deployedState: row.state } }
  } catch (error) {
    return { success: false, error: toError(error).message }
  }
}

export async function executeRevertToVersion(
  params: { workflowId?: string; version?: number },
  context: ExecutionContext
): Promise<ToolCallResult> {
  try {
    const workflowId = params.workflowId || context.workflowId
    if (!workflowId) {
      return { success: false, error: 'workflowId is required' }
    }
    const version = params.version
    if (version === undefined || version === null) {
      return { success: false, error: 'version is required' }
    }

    const { workflow: workflowRecord } = await ensureWorkflowAccess(
      workflowId,
      context.userId,
      'admin'
    )
    const result = await performRevertToVersion({
      workflowId,
      version,
      userId: context.userId,
      workflow: workflowRecord as Record<string, unknown>,
    })

    if (!result.success) {
      return { success: false, error: result.error || 'Failed to revert' }
    }

    return {
      success: true,
      output: {
        message: `Reverted workflow to deployment version ${version}`,
        lastSaved: result.lastSaved,
      },
    }
  } catch (error) {
    return { success: false, error: toError(error).message }
  }
}
