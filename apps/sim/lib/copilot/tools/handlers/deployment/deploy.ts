import { db } from '@sim/db'
import { chat, workflowMcpServer, workflowMcpTool } from '@sim/db/schema'
import { and, eq, isNull } from 'drizzle-orm'
import { AuditAction, AuditResourceType, recordAudit } from '@/lib/audit/log'
import type { ExecutionContext, ToolCallResult } from '@/lib/copilot/request/types'
import { toError } from '@/lib/core/utils/helpers'
import { getBaseUrl } from '@/lib/core/utils/urls'
import { generateId } from '@/lib/core/utils/uuid'
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

function buildWorkflowApiEndpoint(baseUrl: string, workflowId: string): string {
  return `${baseUrl}/api/workflows/${workflowId}/execute`
}

function buildWorkflowApiConfig(baseUrl: string, apiEndpoint: string) {
  return {
    endpoint: apiEndpoint,
    authentication: {
      type: 'api_key',
      acceptedHeaders: ['X-API-Key: YOUR_API_KEY', 'Authorization: Bearer YOUR_API_KEY'],
    },
    modes: {
      sync: {
        method: 'POST',
        transport: 'json',
        stream: false,
        body: { input: { key: 'value' } },
      },
      stream: {
        method: 'POST',
        transport: 'sse',
        stream: true,
        body: { stream: true, input: { key: 'value' } },
      },
      async: {
        method: 'POST',
        transport: 'json',
        stream: false,
        headers: { 'X-Execution-Mode': 'async' },
        body: { input: { key: 'value' } },
        jobStatusEndpointTemplate: `${baseUrl}/api/jobs/{jobId}`,
      },
    },
  }
}

function buildWorkflowApiExamples(baseUrl: string, apiEndpoint: string) {
  return {
    sync: `curl -X POST "${apiEndpoint}" \\
  -H "Content-Type: application/json" \\
  -H "X-API-Key: YOUR_API_KEY" \\
  -d '{"input":{"key":"value"}}'`,
    stream: `curl -N -X POST "${apiEndpoint}" \\
  -H "Content-Type: application/json" \\
  -H "X-API-Key: YOUR_API_KEY" \\
  -d '{"stream":true,"input":{"key":"value"}}'`,
    async: `curl -X POST "${apiEndpoint}" \\
  -H "Content-Type: application/json" \\
  -H "X-API-Key: YOUR_API_KEY" \\
  -H "X-Execution-Mode: async" \\
  -d '{"input":{"key":"value"}}'`,
    poll: `curl "${baseUrl}/api/jobs/JOB_ID" \\
  -H "X-API-Key: YOUR_API_KEY"`,
  }
}

function buildMcpClientExamples(serverName: string, serverUrl: string) {
  return {
    cursor: {
      mcpServers: {
        [serverName]: {
          url: serverUrl,
          headers: { 'X-API-Key': 'YOUR_API_KEY' },
        },
      },
    },
    claudeCode: `claude mcp add ${serverName} --url "${serverUrl}" --header "X-API-Key: YOUR_API_KEY"`,
    claudeDesktop: {
      mcpServers: {
        [serverName]: {
          command: 'npx',
          args: ['-y', 'mcp-remote', serverUrl, '--header', 'X-API-Key:YOUR_API_KEY'],
        },
      },
    },
    vscode: {
      mcp: {
        servers: {
          [serverName]: {
            type: 'http',
            url: serverUrl,
            headers: { 'X-API-Key': 'YOUR_API_KEY' },
          },
        },
      },
    },
  }
}

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
      const baseUrl = getBaseUrl()
      const apiEndpoint = buildWorkflowApiEndpoint(baseUrl, workflowId)
      return {
        success: true,
        output: {
          workflowId,
          isDeployed: false,
          apiEndpoint,
          baseUrl,
          deploymentType: 'api',
          deploymentStatus: {
            api: {
              isDeployed: false,
              endpoint: apiEndpoint,
            },
          },
          deploymentConfig: {
            api: buildWorkflowApiConfig(baseUrl, apiEndpoint),
          },
          examples: {
            api: {
              curl: buildWorkflowApiExamples(baseUrl, apiEndpoint),
            },
          },
        },
      }
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
    const apiEndpoint = buildWorkflowApiEndpoint(baseUrl, workflowId)
    const apiConfig = buildWorkflowApiConfig(baseUrl, apiEndpoint)
    const apiExamples = buildWorkflowApiExamples(baseUrl, apiEndpoint)
    return {
      success: true,
      output: {
        workflowId,
        isDeployed: true,
        deployedAt: result.deployedAt,
        version: result.version,
        apiEndpoint,
        baseUrl,
        deploymentType: 'api',
        deploymentStatus: {
          api: {
            isDeployed: true,
            endpoint: apiEndpoint,
            deployedAt: result.deployedAt,
            version: result.version,
          },
        },
        deploymentConfig: {
          api: apiConfig,
        },
        examples: {
          api: {
            curl: apiExamples,
          },
        },
      },
    }
  } catch (error) {
    return { success: false, error: toError(error).message }
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
      const baseUrl = getBaseUrl()
      const apiEndpoint = buildWorkflowApiEndpoint(baseUrl, workflowId)
      const apiConfig = buildWorkflowApiConfig(baseUrl, apiEndpoint)
      const apiExamples = buildWorkflowApiExamples(baseUrl, apiEndpoint)
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
          deploymentType: 'chat',
          apiEndpoint,
          baseUrl,
          deploymentStatus: {
            api: {
              isDeployed: true,
              endpoint: apiEndpoint,
            },
            chat: {
              isDeployed: false,
              identifier: existing[0].identifier,
              title: existing[0].title,
            },
          },
          deploymentConfig: {
            api: apiConfig,
            chat: {
              identifier: existing[0].identifier,
              title: existing[0].title,
              description: existing[0].description || '',
              authType: existing[0].authType,
              allowedEmails: (existing[0].allowedEmails as string[]) || [],
              outputConfigs:
                (existing[0].outputConfigs as Array<{ blockId: string; path: string }>) || [],
              welcomeMessage:
                (existing[0].customizations as { welcomeMessage?: string } | null)
                  ?.welcomeMessage || 'Hi there! How can I help you today?',
            },
          },
          examples: {
            api: {
              curl: apiExamples,
            },
          },
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
        | { primaryColor?: string; welcomeMessage?: string; imageUrl?: string }
        | undefined) || {}
    const resolvedDescription = String(params.description || existingDeployment?.description || '')
    const resolvedAuthType = (params.authType || existingDeployment?.authType || 'public') as
      | 'public'
      | 'password'
      | 'email'
      | 'sso'
    const resolvedAllowedEmails =
      params.allowedEmails || (existingDeployment?.allowedEmails as string[]) || []
    const resolvedOutputConfigs = (params.outputConfigs ||
      existingDeployment?.outputConfigs ||
      []) as Array<{
      blockId: string
      path: string
    }>
    const welcomeMessage =
      typeof params.welcomeMessage === 'string'
        ? params.welcomeMessage
        : params.customizations?.welcomeMessage || existingCustomizations.welcomeMessage
    const imageUrl =
      params.customizations?.imageUrl ||
      params.customizations?.iconUrl ||
      existingCustomizations.imageUrl

    const result = await performChatDeploy({
      workflowId,
      userId: context.userId,
      identifier,
      title,
      description: resolvedDescription,
      customizations: {
        primaryColor:
          params.customizations?.primaryColor ||
          existingCustomizations.primaryColor ||
          'var(--brand-hover)',
        welcomeMessage: welcomeMessage || 'Hi there! How can I help you today?',
        ...(imageUrl ? { imageUrl } : {}),
      },
      authType: resolvedAuthType,
      password: params.password,
      allowedEmails: resolvedAllowedEmails,
      outputConfigs: resolvedOutputConfigs,
      workspaceId: workflowRecord.workspaceId,
    })

    if (!result.success) {
      return { success: false, error: result.error || 'Failed to deploy chat' }
    }

    const baseUrl = getBaseUrl()
    const apiEndpoint = buildWorkflowApiEndpoint(baseUrl, workflowId)
    const apiConfig = buildWorkflowApiConfig(baseUrl, apiEndpoint)
    const apiExamples = buildWorkflowApiExamples(baseUrl, apiEndpoint)
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
        apiEndpoint,
        baseUrl,
        deployedAt: result.deployedAt || null,
        version: result.version,
        deploymentType: 'chat',
        deploymentStatus: {
          api: {
            isDeployed: true,
            endpoint: apiEndpoint,
            deployedAt: result.deployedAt || null,
            version: result.version,
          },
          chat: {
            isDeployed: true,
            identifier,
            chatUrl: result.chatUrl,
            title,
            description: resolvedDescription,
            authType: resolvedAuthType,
          },
        },
        deploymentConfig: {
          api: apiConfig,
          chat: {
            identifier,
            chatUrl: result.chatUrl,
            title,
            description: resolvedDescription,
            authType: resolvedAuthType,
            allowedEmails: resolvedAllowedEmails,
            outputConfigs: resolvedOutputConfigs,
            welcomeMessage: welcomeMessage || 'Hi there! How can I help you today?',
            primaryColor:
              params.customizations?.primaryColor ||
              existingCustomizations.primaryColor ||
              'var(--brand-hover)',
            ...(imageUrl ? { imageUrl } : {}),
          },
        },
        examples: {
          chat: {
            open: result.chatUrl,
          },
          api: {
            curl: apiExamples,
          },
        },
      },
    }
  } catch (error) {
    return { success: false, error: toError(error).message }
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
    const [serverRecord] = await db
      .select({
        id: workflowMcpServer.id,
        name: workflowMcpServer.name,
      })
      .from(workflowMcpServer)
      .where(
        and(
          eq(workflowMcpServer.id, serverId),
          eq(workflowMcpServer.workspaceId, workspaceId),
          isNull(workflowMcpServer.deletedAt)
        )
      )
      .limit(1)
    if (!serverRecord) {
      return { success: false, error: 'MCP server not found in this workspace' }
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
        output: {
          workflowId,
          serverId,
          serverName: serverRecord.name,
          action: 'undeploy',
          removed: true,
          deploymentType: 'mcp',
          deploymentStatus: {
            mcp: {
              isDeployed: false,
              serverId,
              serverName: serverRecord.name,
            },
          },
        },
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
    const apiEndpoint = buildWorkflowApiEndpoint(baseUrl, workflowId)
    const clientExamples = buildMcpClientExamples(serverRecord.name, mcpServerUrl)

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
        output: {
          toolId,
          toolName,
          toolDescription,
          updated: true,
          mcpServerUrl,
          baseUrl,
          serverId,
          serverName: serverRecord.name,
          deploymentType: 'mcp',
          apiEndpoint,
          deploymentStatus: {
            api: {
              isDeployed: true,
              endpoint: apiEndpoint,
            },
            mcp: {
              isDeployed: true,
              serverId,
              serverName: serverRecord.name,
              toolId,
              toolName,
              updated: true,
            },
          },
          deploymentConfig: {
            mcp: {
              serverId,
              serverName: serverRecord.name,
              serverUrl: mcpServerUrl,
              toolId,
              toolName,
              toolDescription,
              parameterSchema,
              authentication: {
                type: 'api_key',
                header: 'X-API-Key: YOUR_API_KEY',
              },
            },
          },
          examples: {
            mcp: clientExamples,
          },
        },
      }
    }

    const toolId = generateId()
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
      output: {
        toolId,
        toolName,
        toolDescription,
        updated: false,
        mcpServerUrl,
        baseUrl,
        serverId,
        serverName: serverRecord.name,
        deploymentType: 'mcp',
        apiEndpoint,
        deploymentStatus: {
          api: {
            isDeployed: true,
            endpoint: apiEndpoint,
          },
          mcp: {
            isDeployed: true,
            serverId,
            serverName: serverRecord.name,
            toolId,
            toolName,
            updated: false,
          },
        },
        deploymentConfig: {
          mcp: {
            serverId,
            serverName: serverRecord.name,
            serverUrl: mcpServerUrl,
            toolId,
            toolName,
            toolDescription,
            parameterSchema,
            authentication: {
              type: 'api_key',
              header: 'X-API-Key: YOUR_API_KEY',
            },
          },
        },
        examples: {
          mcp: clientExamples,
        },
      },
    }
  } catch (error) {
    return { success: false, error: toError(error).message }
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
    const apiEndpoint = buildWorkflowApiEndpoint(baseUrl, workflowId)
    const apiConfig = buildWorkflowApiConfig(baseUrl, apiEndpoint)
    const apiExamples = buildWorkflowApiExamples(baseUrl, apiEndpoint)
    return {
      success: true,
      output: {
        workflowId,
        isDeployed: true,
        deployedAt: result.deployedAt || null,
        version: result.version,
        apiEndpoint,
        baseUrl,
        deploymentType: 'api',
        deploymentStatus: {
          api: {
            isDeployed: true,
            endpoint: apiEndpoint,
            deployedAt: result.deployedAt || null,
            version: result.version,
          },
        },
        deploymentConfig: {
          api: apiConfig,
        },
        examples: {
          api: {
            curl: apiExamples,
          },
        },
      },
    }
  } catch (error) {
    return { success: false, error: toError(error).message }
  }
}
