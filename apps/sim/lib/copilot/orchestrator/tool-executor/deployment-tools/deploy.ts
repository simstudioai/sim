import crypto from 'crypto'
import { db } from '@sim/db'
import { chat, workflowMcpTool } from '@sim/db/schema'
import { and, eq, isNull } from 'drizzle-orm'
import { AuditAction, AuditResourceType, recordAudit } from '@/lib/audit/log'
import type { ExecutionContext, ToolCallResult } from '@/lib/copilot/orchestrator/types'
import { getBaseUrl } from '@/lib/core/utils/urls'
import { mcpPubSub } from '@/lib/mcp/pubsub'
import { generateParameterSchemaForWorkflow } from '@/lib/mcp/workflow-mcp-sync'
import { sanitizeToolName } from '@/lib/mcp/workflow-tool-schema'
import {
  performChatDeploy,
  performChatUndeploy,
  performFullDeploy,
  performFullUndeploy,
} from '@/lib/workflows/orchestration'
import { checkChatAccess, checkWorkflowAccessForChatCreation } from '@/app/api/chat/utils'
import { ensureWorkflowAccess } from '../access'
import type { DeployApiParams, DeployChatParams, DeployMcpParams } from '../param-types'

export async function executeDeployApi(
  params: DeployApiParams,
  context: ExecutionContext
): Promise<ToolCallResult> {
  try {
    const workflowId = params.workflowId || context.workflowId
    if (!workflowId) {
      return { success: false, error: 'workflowId is required' }
    }
    const action = params.action === 'undeploy' ? 'undeploy' : 'deploy'
    const { workflow: workflowRecord } = await ensureWorkflowAccess(
      workflowId,
      context.userId,
      'admin'
    )

    if (action === 'undeploy') {
      const result = await performFullUndeploy({ workflowId, userId: context.userId })
      if (!result.success) {
        return { success: false, error: result.error || 'Failed to undeploy workflow' }
      }
      return { success: true, output: { workflowId, isDeployed: false } }
    }

    const result = await performFullDeploy({
      workflowId,
      userId: context.userId,
      workflowName: workflowRecord.name || undefined,
    })
    if (!result.success) {
      return { success: false, error: result.error || 'Failed to deploy workflow' }
    }

    const baseUrl = getBaseUrl()
    return {
      success: true,
      output: {
        workflowId,
        isDeployed: true,
        deployedAt: result.deployedAt,
        version: result.version,
        apiEndpoint: `${baseUrl}/api/workflows/${workflowId}/run`,
        baseUrl,
      },
    }
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : String(error) }
  }
}

export async function executeDeployChat(
  params: DeployChatParams,
  context: ExecutionContext
): Promise<ToolCallResult> {
  try {
    const workflowId = params.workflowId || context.workflowId
    if (!workflowId) {
      return { success: false, error: 'workflowId is required' }
    }

    const action = params.action === 'undeploy' ? 'undeploy' : 'deploy'
    if (action === 'undeploy') {
      const existing = await db
        .select()
        .from(chat)
        .where(and(eq(chat.workflowId, workflowId), isNull(chat.archivedAt)))
        .limit(1)
      if (!existing.length) {
        return { success: false, error: 'No active chat deployment found for this workflow' }
      }
      const { hasAccess, workspaceId: chatWorkspaceId } = await checkChatAccess(
        existing[0].id,
        context.userId
      )
      if (!hasAccess) {
        return { success: false, error: 'Unauthorized chat access' }
      }
      const undeployResult = await performChatUndeploy({
        chatId: existing[0].id,
        userId: context.userId,
        workspaceId: chatWorkspaceId,
      })
      if (!undeployResult.success) {
        return { success: false, error: undeployResult.error || 'Failed to undeploy chat' }
      }
      return {
        success: true,
        output: {
          workflowId,
          success: true,
          action: 'undeploy',
          isDeployed: true,
          isChatDeployed: false,
        },
      }
    }

    const { hasAccess, workflow: workflowRecord } = await checkWorkflowAccessForChatCreation(
      workflowId,
      context.userId
    )
    if (!hasAccess || !workflowRecord) {
      return { success: false, error: 'Workflow not found or access denied' }
    }

    const [existingDeployment] = await db
      .select()
      .from(chat)
      .where(and(eq(chat.workflowId, workflowId), isNull(chat.archivedAt)))
      .limit(1)

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
      .where(and(eq(chat.identifier, identifier), isNull(chat.archivedAt)))
      .limit(1)
    if (existingIdentifier.length > 0 && existingIdentifier[0].id !== existingDeployment?.id) {
      return { success: false, error: 'Identifier already in use' }
    }

    const existingCustomizations =
      (existingDeployment?.customizations as
        | { primaryColor?: string; welcomeMessage?: string }
        | undefined) || {}

    const result = await performChatDeploy({
      workflowId,
      userId: context.userId,
      identifier,
      title,
      description: String(params.description || existingDeployment?.description || ''),
      customizations: {
        primaryColor:
          params.customizations?.primaryColor ||
          existingCustomizations.primaryColor ||
          'var(--brand-hover)',
        welcomeMessage:
          params.customizations?.welcomeMessage ||
          existingCustomizations.welcomeMessage ||
          'Hi there! How can I help you today?',
      },
      authType: (params.authType || existingDeployment?.authType || 'public') as
        | 'public'
        | 'password'
        | 'email'
        | 'sso',
      password: params.password,
      allowedEmails: params.allowedEmails || (existingDeployment?.allowedEmails as string[]) || [],
      outputConfigs: (params.outputConfigs || existingDeployment?.outputConfigs || []) as Array<{
        blockId: string
        path: string
      }>,
      workspaceId: workflowRecord.workspaceId,
    })

    if (!result.success) {
      return { success: false, error: result.error || 'Failed to deploy chat' }
    }

    const baseUrl = getBaseUrl()
    return {
      success: true,
      output: {
        workflowId,
        success: true,
        action: 'deploy',
        isDeployed: true,
        isChatDeployed: true,
        identifier,
        chatUrl: result.chatUrl,
        apiEndpoint: `${baseUrl}/api/workflows/${workflowId}/run`,
        baseUrl,
      },
    }
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : String(error) }
  }
}

export async function executeDeployMcp(
  params: DeployMcpParams,
  context: ExecutionContext
): Promise<ToolCallResult> {
  try {
    const workflowId = params.workflowId || context.workflowId
    if (!workflowId) {
      return { success: false, error: 'workflowId is required' }
    }

    const { workflow: workflowRecord } = await ensureWorkflowAccess(
      workflowId,
      context.userId,
      'admin'
    )
    const workspaceId = workflowRecord.workspaceId
    if (!workspaceId) {
      return { success: false, error: 'workspaceId is required' }
    }

    const serverId = params.serverId
    if (!serverId) {
      return {
        success: false,
        error: 'serverId is required. Use list_workspace_mcp_servers to get available servers.',
      }
    }

    // Handle undeploy action — remove workflow from MCP server
    if (params.action === 'undeploy') {
      const deleted = await db
        .delete(workflowMcpTool)
        .where(
          and(eq(workflowMcpTool.serverId, serverId), eq(workflowMcpTool.workflowId, workflowId))
        )
        .returning({ id: workflowMcpTool.id })

      if (deleted.length === 0) {
        return { success: false, error: 'Workflow is not deployed to this MCP server' }
      }

      mcpPubSub?.publishWorkflowToolsChanged({ serverId, workspaceId })

      recordAudit({
        workspaceId,
        actorId: context.userId,
        action: AuditAction.MCP_SERVER_REMOVED,
        resourceType: AuditResourceType.MCP_SERVER,
        resourceId: serverId,
        description: `Undeployed workflow "${workflowId}" from MCP server`,
      })

      return {
        success: true,
        output: { workflowId, serverId, action: 'undeploy', removed: true },
      }
    }

    if (!workflowRecord.isDeployed) {
      return {
        success: false,
        error: 'Workflow must be deployed before adding as an MCP tool. Use deploy_api first.',
      }
    }

    const existingTool = await db
      .select()
      .from(workflowMcpTool)
      .where(
        and(
          eq(workflowMcpTool.serverId, serverId),
          eq(workflowMcpTool.workflowId, workflowId),
          isNull(workflowMcpTool.archivedAt)
        )
      )
      .limit(1)

    const toolName = sanitizeToolName(
      params.toolName || workflowRecord.name || `workflow_${workflowId}`
    )
    const toolDescription =
      params.toolDescription ||
      workflowRecord.description ||
      `Execute ${workflowRecord.name} workflow`
    const parameterSchema =
      params.parameterSchema && Object.keys(params.parameterSchema).length > 0
        ? params.parameterSchema
        : await generateParameterSchemaForWorkflow(workflowId)

    const baseUrl = getBaseUrl()
    const mcpServerUrl = `${baseUrl}/api/mcp/serve/${serverId}`

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

      mcpPubSub?.publishWorkflowToolsChanged({ serverId, workspaceId })

      recordAudit({
        workspaceId,
        actorId: context.userId,
        action: AuditAction.MCP_SERVER_UPDATED,
        resourceType: AuditResourceType.MCP_SERVER,
        resourceId: serverId,
        description: `Updated MCP tool "${toolName}" on server`,
      })

      return {
        success: true,
        output: { toolId, toolName, toolDescription, updated: true, mcpServerUrl, baseUrl },
      }
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

    mcpPubSub?.publishWorkflowToolsChanged({ serverId, workspaceId })

    recordAudit({
      workspaceId,
      actorId: context.userId,
      action: AuditAction.MCP_SERVER_ADDED,
      resourceType: AuditResourceType.MCP_SERVER,
      resourceId: serverId,
      description: `Deployed workflow as MCP tool "${toolName}"`,
    })

    return {
      success: true,
      output: { toolId, toolName, toolDescription, updated: false, mcpServerUrl, baseUrl },
    }
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : String(error) }
  }
}

export async function executeRedeploy(
  params: { workflowId?: string },
  context: ExecutionContext
): Promise<ToolCallResult> {
  try {
    const workflowId = params.workflowId || context.workflowId
    if (!workflowId) {
      return { success: false, error: 'workflowId is required' }
    }
    await ensureWorkflowAccess(workflowId, context.userId, 'admin')

    const result = await performFullDeploy({ workflowId, userId: context.userId })
    if (!result.success) {
      return { success: false, error: result.error || 'Failed to redeploy workflow' }
    }
    const baseUrl = getBaseUrl()
    return {
      success: true,
      output: {
        workflowId,
        isDeployed: true,
        deployedAt: result.deployedAt || null,
        version: result.version,
        apiEndpoint: `${baseUrl}/api/workflows/${workflowId}/run`,
        baseUrl,
      },
    }
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : String(error) }
  }
}
