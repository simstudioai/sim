import { db } from '@sim/db'
import { chat, workflowMcpServer, workflowMcpTool, workflow as workflowTable } from '@sim/db/schema'
import { toError } from '@sim/utils/errors'
import { and, eq, isNull } from 'drizzle-orm'
import type { ExecutionContext, ToolCallResult } from '@/lib/copilot/request/types'
import { getBaseUrl } from '@/lib/core/utils/urls'
import {
  performCreateWorkflowMcpTool,
  performDeleteWorkflowMcpTool,
  performUpdateWorkflowMcpTool,
} from '@/lib/mcp/orchestration'
import { getDeployedWorkflowInputFormat } from '@/lib/mcp/workflow-mcp-sync'
import { generateParameterSchema, sanitizeToolName } from '@/lib/mcp/workflow-tool-schema'
import { notifyWorkflowUpdated } from '@/lib/workflows/notify-socket'
import {
  performChatDeploy,
  performChatUndeploy,
  performFullDeploy,
  performFullUndeploy,
} from '@/lib/workflows/orchestration'
import {
  loadWorkflowFromNormalizedTables,
  saveWorkflowToNormalizedTables,
} from '@/lib/workflows/persistence/utils'
import { isInputDefinitionTrigger } from '@/lib/workflows/triggers/input-definition-triggers'
import { checkChatAccess, checkWorkflowAccessForChatCreation } from '@/app/api/chat/utils'
import type { BlockState, WorkflowState } from '@/stores/workflows/workflow/types'
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

    const versionDescription = params.versionDescription?.trim()
    if (!versionDescription) {
      return {
        success: false,
        error:
          'versionDescription is required when deploying. Provide a concise summary of what changed in this deployment version (call diff_workflows with ref1 "live" and ref2 "draft" if unsure what changed).',
      }
    }

    const versionName = params.versionName?.trim()
    if (!versionName) {
      return {
        success: false,
        error:
          'versionName is required when deploying. Provide a short human-readable label for this deployment version.',
      }
    }

    const result = await performFullDeploy({
      workflowId,
      userId: context.userId,
      workflowName: workflowRecord.name || undefined,
      versionDescription,
      versionName,
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

    const versionDescription = params.versionDescription?.trim()
    if (!versionDescription) {
      return {
        success: false,
        error:
          'versionDescription is required when deploying. Provide a concise summary of what changed in this deployment version (distinct from the chat-facing description; call diff_workflows with ref1 "live" and ref2 "draft" if unsure).',
      }
    }

    const versionName = params.versionName?.trim()
    if (!versionName) {
      return {
        success: false,
        error:
          'versionName is required when deploying. Provide a short human-readable label for this deployment version (distinct from the chat title).',
      }
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
      versionDescription,
      versionName,
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

/**
 * Persists per-parameter descriptions onto the workflow's draft start block input
 * format — the single source of truth the deployed tool schema is regenerated from.
 * Writing them here (rather than only onto the tool) keeps them durable: a later
 * redeploy regenerates the tool schema from these fields instead of wiping them.
 * Matches fields by name, preserves every other field property, and no-ops when
 * nothing changes. Mirrors the load → mutate → save → notify pattern used by the
 * copilot workflow mutation handlers.
 */
async function persistParameterDescriptionsToStartBlock(
  workflowId: string,
  descriptions: Record<string, string>
): Promise<void> {
  if (Object.keys(descriptions).length === 0) return

  const normalized = await loadWorkflowFromNormalizedTables(workflowId)
  if (!normalized?.blocks) return

  const blocks = normalized.blocks as Record<string, BlockState>
  const startBlockId = Object.keys(blocks).find((id) => isInputDefinitionTrigger(blocks[id]?.type))
  if (!startBlockId) return

  const startBlock = blocks[startBlockId]
  const inputFormatSubBlock = startBlock.subBlocks?.inputFormat
  const rawFields = inputFormatSubBlock?.value
  if (!Array.isArray(rawFields) || rawFields.length === 0) return

  let changed = false
  const nextFields = rawFields.map((field) => {
    if (!field || typeof field !== 'object') return field
    const name = (field as { name?: string }).name
    if (!name || !(name in descriptions)) return field
    const nextDescription = descriptions[name]
    if ((field as { description?: string }).description === nextDescription) return field
    changed = true
    return { ...field, description: nextDescription }
  })
  if (!changed) return

  const nextState: WorkflowState = {
    blocks: {
      ...blocks,
      [startBlockId]: {
        ...startBlock,
        subBlocks: {
          ...startBlock.subBlocks,
          inputFormat: { ...inputFormatSubBlock, value: nextFields },
        },
      },
    },
    edges: normalized.edges || [],
    loops: normalized.loops || {},
    parallels: normalized.parallels || {},
    lastSaved: Date.now(),
  }

  const saveResult = await saveWorkflowToNormalizedTables(workflowId, nextState)
  if (!saveResult.success) {
    throw new Error(saveResult.error || 'Failed to persist parameter descriptions')
  }

  await db
    .update(workflowTable)
    .set({ lastSynced: new Date(), updatedAt: new Date() })
    .where(eq(workflowTable.id, workflowId))

  notifyWorkflowUpdated(workflowId)
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
      const [existingTool] = await db
        .select({ id: workflowMcpTool.id })
        .from(workflowMcpTool)
        .where(
          and(
            eq(workflowMcpTool.serverId, serverId),
            eq(workflowMcpTool.workflowId, workflowId),
            isNull(workflowMcpTool.archivedAt)
          )
        )
        .limit(1)

      if (!existingTool) {
        return { success: false, error: 'Workflow is not deployed to this MCP server' }
      }

      const deleteResult = await performDeleteWorkflowMcpTool({
        serverId,
        toolId: existingTool.id,
        workspaceId,
        userId: context.userId,
      })
      if (!deleteResult.success) {
        return { success: false, error: deleteResult.error || 'Failed to undeploy MCP tool' }
      }

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
    /**
     * Descriptions are workflow-input data: persist them onto the draft start block
     * so they live with the workflow and survive future redeploys (single source of
     * truth, matching the deploy modal). Then build the tool schema from the deployed
     * input format overlaid with the same descriptions so the tool is correct
     * immediately — the deploy modal relies on a redeploy for this, but this tool
     * doesn't redeploy, so it sets the schema directly. Both paths converge: the next
     * redeploy regenerates the schema from these now-persisted start-block fields.
     */
    const inputFormat = await getDeployedWorkflowInputFormat(workflowId)
    const parameterDescriptions = Object.fromEntries(
      (params.parameterDescriptions ?? [])
        .filter((entry) => entry && typeof entry.name === 'string' && entry.name.trim() !== '')
        .map((entry) => [entry.name, entry.description ?? ''])
    )
    await persistParameterDescriptionsToStartBlock(workflowId, parameterDescriptions)
    const parameterSchema = generateParameterSchema(inputFormat, parameterDescriptions)
    const baseUrl = getBaseUrl()
    const mcpServerUrl = `${baseUrl}/api/mcp/serve/${serverId}`
    const apiEndpoint = buildWorkflowApiEndpoint(baseUrl, workflowId)
    const clientExamples = buildMcpClientExamples(serverRecord.name, mcpServerUrl)

    if (existingTool.length > 0) {
      const toolId = existingTool[0].id
      const updateResult = await performUpdateWorkflowMcpTool({
        serverId,
        toolId,
        workspaceId,
        userId: context.userId,
        toolName,
        toolDescription,
        parameterSchema,
      })
      if (!updateResult.success || !updateResult.tool) {
        return { success: false, error: updateResult.error || 'Failed to update MCP tool' }
      }

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

    const createResult = await performCreateWorkflowMcpTool({
      serverId,
      workspaceId,
      userId: context.userId,
      workflowId,
      toolName,
      toolDescription,
      parameterSchema,
    })
    if (!createResult.success || !createResult.tool) {
      return { success: false, error: createResult.error || 'Failed to deploy MCP tool' }
    }
    const toolId = createResult.tool.id

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
  params: { workflowId?: string; versionDescription?: string; versionName?: string },
  context: ExecutionContext
): Promise<ToolCallResult> {
  try {
    const workflowId = params.workflowId || context.workflowId
    if (!workflowId) {
      return { success: false, error: 'workflowId is required' }
    }
    const versionDescription = params.versionDescription?.trim()
    if (!versionDescription) {
      return {
        success: false,
        error:
          'versionDescription is required. Provide a concise summary of what changed in this deployment version (call diff_workflows with ref1 "live" and ref2 "draft" if unsure what changed).',
      }
    }
    const versionName = params.versionName?.trim()
    if (!versionName) {
      return {
        success: false,
        error:
          'versionName is required. Provide a short human-readable label for this deployment version.',
      }
    }
    await ensureWorkflowAccess(workflowId, context.userId, 'admin')

    const result = await performFullDeploy({
      workflowId,
      userId: context.userId,
      versionDescription,
      versionName,
    })
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
