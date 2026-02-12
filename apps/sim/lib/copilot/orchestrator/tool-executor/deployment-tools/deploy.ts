import crypto from 'crypto'
import { db } from '@sim/db'
import { chat, workflowMcpTool } from '@sim/db/schema'
import { and, eq } from 'drizzle-orm'
import type { ExecutionContext, ToolCallResult } from '@/lib/copilot/orchestrator/types'
import { getBaseUrl } from '@/lib/core/utils/urls'
import { mcpPubSub } from '@/lib/mcp/pubsub'
import { generateParameterSchemaForWorkflow } from '@/lib/mcp/workflow-mcp-sync'
import { sanitizeToolName } from '@/lib/mcp/workflow-tool-schema'
import { deployWorkflow, undeployWorkflow } from '@/lib/workflows/persistence/utils'
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

    const existingCustomizations =
      (existingDeployment?.customizations as
        | { primaryColor?: string; welcomeMessage?: string }
        | undefined) || {}

    const payload = {
      workflowId,
      identifier,
      title,
      description: String(params.description || existingDeployment?.description || ''),
      customizations: {
        primaryColor:
          params.customizations?.primaryColor ||
          existingCustomizations.primaryColor ||
          'var(--brand-primary-hover-hex)',
        welcomeMessage:
          params.customizations?.welcomeMessage ||
          existingCustomizations.welcomeMessage ||
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

    const baseUrl = getBaseUrl()
    return {
      success: true,
      output: {
        success: true,
        action: 'deploy',
        isDeployed: true,
        identifier,
        chatUrl: `${baseUrl}/chat/${identifier}`,
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

    const { workflow: workflowRecord } = await ensureWorkflowAccess(workflowId, context.userId)
    const workspaceId = workflowRecord.workspaceId
    if (!workspaceId) {
      return { success: false, error: 'workspaceId is required' }
    }

    if (!workflowRecord.isDeployed) {
      return {
        success: false,
        error:
          'Workflow must be deployed before adding as an MCP tool. Use workflow_deploy(mode: "api") first.',
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
      .where(
        and(eq(workflowMcpTool.serverId, serverId), eq(workflowMcpTool.workflowId, workflowId))
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

    return {
      success: true,
      output: { toolId, toolName, toolDescription, updated: false, mcpServerUrl, baseUrl },
    }
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
    const baseUrl = getBaseUrl()
    return {
      success: true,
      output: {
        workflowId,
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
