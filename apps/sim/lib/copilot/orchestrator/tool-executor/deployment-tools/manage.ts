import crypto from 'crypto'
import { db } from '@sim/db'
import {
  chat,
  workflow,
  workflowDeploymentVersion,
  workflowMcpServer,
  workflowMcpTool,
} from '@sim/db/schema'
import { and, eq, inArray, isNull } from 'drizzle-orm'
import type { ExecutionContext, ToolCallResult } from '@/lib/copilot/orchestrator/types'
import { mcpPubSub } from '@/lib/mcp/pubsub'
import { generateParameterSchemaForWorkflow } from '@/lib/mcp/workflow-mcp-sync'
import { sanitizeToolName } from '@/lib/mcp/workflow-tool-schema'
import { hasValidStartBlock } from '@/lib/workflows/triggers/trigger-utils.server'
import { ensureWorkflowAccess } from '../access'
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
        const parameterSchema = await generateParameterSchemaForWorkflow(wf.id)
        await db.insert(workflowMcpTool).values({
          id: crypto.randomUUID(),
          serverId,
          workflowId: wf.id,
          toolName,
          toolDescription: wf.description || `Execute ${wf.name} workflow`,
          parameterSchema,
          createdAt: new Date(),
          updatedAt: new Date(),
        })
        addedTools.push({ workflowId: wf.id, toolName })
      }
    }

    if (addedTools.length > 0) {
      mcpPubSub?.publishWorkflowToolsChanged({ serverId, workspaceId })
    }

    return { success: true, output: { server, addedTools } }
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : String(error) }
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

    const updates: Record<string, unknown> = { updatedAt: new Date() }

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

    if (Object.keys(updates).length <= 1) {
      return { success: false, error: 'At least one of name, description, or isPublic is required' }
    }

    const [existing] = await db
      .select({ id: workflowMcpServer.id, createdBy: workflowMcpServer.createdBy })
      .from(workflowMcpServer)
      .where(eq(workflowMcpServer.id, serverId))
      .limit(1)

    if (!existing) {
      return { success: false, error: 'MCP server not found' }
    }

    await db.update(workflowMcpServer).set(updates).where(eq(workflowMcpServer.id, serverId))

    return { success: true, output: { serverId, ...updates, updatedAt: undefined } }
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : String(error) }
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

    await db.delete(workflowMcpServer).where(eq(workflowMcpServer.id, serverId))

    mcpPubSub?.publishWorkflowToolsChanged({ serverId, workspaceId: existing.workspaceId })

    return { success: true, output: { serverId, name: existing.name, deleted: true } }
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : String(error) }
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
    return { success: false, error: error instanceof Error ? error.message : String(error) }
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

    await ensureWorkflowAccess(workflowId, context.userId)

    const baseUrl =
      process.env.NEXT_PUBLIC_APP_URL || process.env.APP_URL || 'http://localhost:3000'
    const response = await fetch(
      `${baseUrl}/api/workflows/${workflowId}/deployments/${version}/revert`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': process.env.INTERNAL_API_SECRET || '',
        },
      }
    )

    if (!response.ok) {
      const body = await response.json().catch(() => ({}))
      return { success: false, error: body.error || `Failed to revert (HTTP ${response.status})` }
    }

    const result = await response.json()
    return {
      success: true,
      output: {
        message: `Reverted workflow to deployment version ${version}`,
        lastSaved: result.lastSaved,
      },
    }
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : String(error) }
  }
}
