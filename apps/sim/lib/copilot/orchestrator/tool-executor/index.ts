import { db } from '@sim/db'
import { credential, mcpServers, pendingCredentialDraft, user } from '@sim/db/schema'
import { createLogger } from '@sim/logger'
import { and, eq, isNull, lt } from 'drizzle-orm'
import { AuditAction, AuditResourceType, recordAudit } from '@/lib/audit/log'
import { SIM_AGENT_API_URL } from '@/lib/copilot/constants'
import type {
  ExecutionContext,
  ToolCallResult,
  ToolCallState,
} from '@/lib/copilot/orchestrator/types'
import { routeExecution } from '@/lib/copilot/tools/server/router'
import { env } from '@/lib/core/config/env'
import { getBaseUrl } from '@/lib/core/utils/urls'
import { generateId } from '@/lib/core/utils/uuid'
import { getEffectiveDecryptedEnv } from '@/lib/environment/utils'
import { getKnowledgeBaseById } from '@/lib/knowledge/service'
import { validateMcpDomain } from '@/lib/mcp/domain-check'
import { mcpService } from '@/lib/mcp/service'
import { generateMcpServerId } from '@/lib/mcp/utils'
import { getAllOAuthServices } from '@/lib/oauth/utils'
import { getTableById } from '@/lib/table/service'
import { getWorkspaceFile } from '@/lib/uploads/contexts/workspace/workspace-file-manager'
import {
  deleteCustomTool,
  getCustomToolById,
  listCustomTools,
  upsertCustomTools,
} from '@/lib/workflows/custom-tools/operations'
import { deleteSkill, listSkills, upsertSkills } from '@/lib/workflows/skills/operations'
import { getWorkflowById } from '@/lib/workflows/utils'
import { isMcpTool, isUuid } from '@/executor/constants'
import { executeTool } from '@/tools'
import { getTool, resolveToolId } from '@/tools/utils'
import {
  executeCheckDeploymentStatus,
  executeCreateWorkspaceMcpServer,
  executeDeleteWorkspaceMcpServer,
  executeDeployApi,
  executeDeployChat,
  executeDeployMcp,
  executeGetDeploymentVersion,
  executeListWorkspaceMcpServers,
  executeRedeploy,
  executeRevertToVersion,
  executeUpdateWorkspaceMcpServer,
} from './deployment-tools'
import { executeIntegrationToolDirect } from './integration-tools'
import {
  executeCompleteJob,
  executeCreateJob,
  executeManageJob,
  executeUpdateJobHistory,
} from './job-tools'
import { executeMaterializeFile } from './materialize-file'
import type {
  CheckDeploymentStatusParams,
  CreateFolderParams,
  CreateWorkflowParams,
  CreateWorkspaceMcpServerParams,
  DeleteFolderParams,
  DeleteWorkflowParams,
  DeleteWorkspaceMcpServerParams,
  DeployApiParams,
  DeployChatParams,
  DeployMcpParams,
  GenerateApiKeyParams,
  GetBlockOutputsParams,
  GetBlockUpstreamReferencesParams,
  GetDeployedWorkflowStateParams,
  GetWorkflowDataParams,
  ListFoldersParams,
  ListWorkspaceMcpServersParams,
  MoveFolderParams,
  MoveWorkflowParams,
  OpenResourceParams,
  OpenResourceType,
  RenameFolderParams,
  RenameWorkflowParams,
  RunBlockParams,
  RunFromBlockParams,
  RunWorkflowParams,
  RunWorkflowUntilBlockParams,
  SetGlobalWorkflowVariablesParams,
  UpdateWorkflowParams,
  UpdateWorkspaceMcpServerParams,
  ValidOpenResourceParams,
} from './param-types'
import { PLATFORM_ACTIONS_CONTENT } from './platform-actions'
import { executeVfsGlob, executeVfsGrep, executeVfsList, executeVfsRead } from './vfs-tools'
import {
  executeCreateFolder,
  executeCreateWorkflow,
  executeDeleteFolder,
  executeDeleteWorkflow,
  executeGenerateApiKey,
  executeGetBlockOutputs,
  executeGetBlockUpstreamReferences,
  executeGetDeployedWorkflowState,
  executeGetWorkflowData,
  executeListFolders,
  executeListUserWorkspaces,
  executeMoveFolder,
  executeMoveWorkflow,
  executeRenameFolder,
  executeRenameWorkflow,
  executeRunBlock,
  executeRunFromBlock,
  executeRunWorkflow,
  executeRunWorkflowUntilBlock,
  executeSetGlobalWorkflowVariables,
  executeUpdateWorkflow,
} from './workflow-tools'

const logger = createLogger('CopilotToolExecutor')
const VALID_OPEN_RESOURCE_TYPES = new Set<OpenResourceType>([
  'workflow',
  'table',
  'knowledgebase',
  'file',
])

function validateOpenResourceParams(
  params: OpenResourceParams
): { success: true; params: ValidOpenResourceParams } | { success: false; error: string } {
  if (!params.type) {
    return { success: false, error: 'type is required' }
  }

  if (!VALID_OPEN_RESOURCE_TYPES.has(params.type)) {
    return { success: false, error: `Invalid resource type: ${params.type}` }
  }

  if (!params.id) {
    return { success: false, error: `${params.type} resources require \`id\`` }
  }

  return {
    success: true,
    params: {
      type: params.type,
      id: params.id,
    },
  }
}

type ManageCustomToolOperation = 'add' | 'edit' | 'delete' | 'list'

interface ManageCustomToolSchema {
  type: 'function'
  function: {
    name: string
    description?: string
    parameters: Record<string, unknown>
  }
}

interface ManageCustomToolParams {
  operation?: string
  toolId?: string
  schema?: ManageCustomToolSchema
  code?: string
  title?: string
  workspaceId?: string
}

async function executeManageCustomTool(
  rawParams: Record<string, unknown>,
  context: ExecutionContext
): Promise<ToolCallResult> {
  const params = rawParams as ManageCustomToolParams
  const operation = String(params.operation || '').toLowerCase() as ManageCustomToolOperation
  const workspaceId = params.workspaceId || context.workspaceId

  if (!operation) {
    return { success: false, error: "Missing required 'operation' argument" }
  }

  const writeOps: string[] = ['add', 'edit', 'delete']
  if (
    writeOps.includes(operation) &&
    context.userPermission &&
    context.userPermission !== 'write' &&
    context.userPermission !== 'admin'
  ) {
    return {
      success: false,
      error: `Permission denied: '${operation}' on manage_custom_tool requires write access. You have '${context.userPermission}' permission.`,
    }
  }

  try {
    if (operation === 'list') {
      const toolsForUser = await listCustomTools({
        userId: context.userId,
        workspaceId,
      })

      return {
        success: true,
        output: {
          success: true,
          operation,
          tools: toolsForUser,
          count: toolsForUser.length,
        },
      }
    }

    if (operation === 'add') {
      if (!workspaceId) {
        return {
          success: false,
          error: "workspaceId is required for operation 'add'",
        }
      }
      if (!params.schema || !params.code) {
        return {
          success: false,
          error: "Both 'schema' and 'code' are required for operation 'add'",
        }
      }

      const title = params.title || params.schema.function?.name
      if (!title) {
        return { success: false, error: "Missing tool title or schema.function.name for 'add'" }
      }

      const resultTools = await upsertCustomTools({
        tools: [{ title, schema: params.schema, code: params.code }],
        workspaceId,
        userId: context.userId,
      })
      const created = resultTools.find((tool) => tool.title === title)

      recordAudit({
        workspaceId,
        actorId: context.userId,
        action: AuditAction.CUSTOM_TOOL_CREATED,
        resourceType: AuditResourceType.CUSTOM_TOOL,
        resourceId: created?.id,
        resourceName: title,
        description: `Created custom tool "${title}"`,
      })

      return {
        success: true,
        output: {
          success: true,
          operation,
          toolId: created?.id,
          title,
          message: `Created custom tool "${title}"`,
        },
      }
    }

    if (operation === 'edit') {
      if (!workspaceId) {
        return {
          success: false,
          error: "workspaceId is required for operation 'edit'",
        }
      }
      if (!params.toolId) {
        return { success: false, error: "'toolId' is required for operation 'edit'" }
      }
      if (!params.schema && !params.code) {
        return {
          success: false,
          error: "At least one of 'schema' or 'code' is required for operation 'edit'",
        }
      }

      const existing = await getCustomToolById({
        toolId: params.toolId,
        userId: context.userId,
        workspaceId,
      })
      if (!existing) {
        return { success: false, error: `Custom tool not found: ${params.toolId}` }
      }

      const mergedSchema = params.schema || (existing.schema as ManageCustomToolSchema)
      const mergedCode = params.code || existing.code
      const title = params.title || mergedSchema.function?.name || existing.title

      await upsertCustomTools({
        tools: [{ id: params.toolId, title, schema: mergedSchema, code: mergedCode }],
        workspaceId,
        userId: context.userId,
      })

      recordAudit({
        workspaceId,
        actorId: context.userId,
        action: AuditAction.CUSTOM_TOOL_UPDATED,
        resourceType: AuditResourceType.CUSTOM_TOOL,
        resourceId: params.toolId,
        resourceName: title,
        description: `Updated custom tool "${title}"`,
      })

      return {
        success: true,
        output: {
          success: true,
          operation,
          toolId: params.toolId,
          title,
          message: `Updated custom tool "${title}"`,
        },
      }
    }

    if (operation === 'delete') {
      if (!params.toolId) {
        return { success: false, error: "'toolId' is required for operation 'delete'" }
      }

      const deleted = await deleteCustomTool({
        toolId: params.toolId,
        userId: context.userId,
        workspaceId,
      })
      if (!deleted) {
        return { success: false, error: `Custom tool not found: ${params.toolId}` }
      }

      recordAudit({
        workspaceId,
        actorId: context.userId,
        action: AuditAction.CUSTOM_TOOL_DELETED,
        resourceType: AuditResourceType.CUSTOM_TOOL,
        resourceId: params.toolId,
        description: 'Deleted custom tool',
      })

      return {
        success: true,
        output: {
          success: true,
          operation,
          toolId: params.toolId,
          message: 'Deleted custom tool',
        },
      }
    }

    return {
      success: false,
      error: `Unsupported operation for manage_custom_tool: ${operation}`,
    }
  } catch (error) {
    logger
      .withMetadata({ messageId: context.messageId })
      .error('manage_custom_tool execution failed', {
        operation,
        workspaceId,
        userId: context.userId,
        error: error instanceof Error ? error.message : String(error),
      })
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Failed to manage custom tool',
    }
  }
}

type ManageMcpToolOperation = 'add' | 'edit' | 'delete' | 'list'

interface ManageMcpToolConfig {
  name?: string
  transport?: string
  url?: string
  headers?: Record<string, string>
  timeout?: number
  enabled?: boolean
}

interface ManageMcpToolParams {
  operation?: string
  serverId?: string
  config?: ManageMcpToolConfig
}

async function executeManageMcpTool(
  rawParams: Record<string, unknown>,
  context: ExecutionContext
): Promise<ToolCallResult> {
  const params = rawParams as ManageMcpToolParams
  const operation = String(params.operation || '').toLowerCase() as ManageMcpToolOperation
  const workspaceId = context.workspaceId

  if (!operation) {
    return { success: false, error: "Missing required 'operation' argument" }
  }

  if (!workspaceId) {
    return { success: false, error: 'workspaceId is required' }
  }

  const writeOps: string[] = ['add', 'edit', 'delete']
  if (
    writeOps.includes(operation) &&
    context.userPermission &&
    context.userPermission !== 'write' &&
    context.userPermission !== 'admin'
  ) {
    return {
      success: false,
      error: `Permission denied: '${operation}' on manage_mcp_tool requires write access. You have '${context.userPermission}' permission.`,
    }
  }

  try {
    if (operation === 'list') {
      const servers = await db
        .select()
        .from(mcpServers)
        .where(and(eq(mcpServers.workspaceId, workspaceId), isNull(mcpServers.deletedAt)))

      return {
        success: true,
        output: {
          success: true,
          operation,
          servers: servers.map((s) => ({
            id: s.id,
            name: s.name,
            url: s.url,
            transport: s.transport,
            enabled: s.enabled,
            connectionStatus: s.connectionStatus,
          })),
          count: servers.length,
        },
      }
    }

    if (operation === 'add') {
      const config = params.config
      if (!config?.name || !config?.url) {
        return { success: false, error: "config.name and config.url are required for 'add'" }
      }

      validateMcpDomain(config.url)

      const serverId = generateMcpServerId(workspaceId, config.url)

      const [existing] = await db
        .select({ id: mcpServers.id, deletedAt: mcpServers.deletedAt })
        .from(mcpServers)
        .where(and(eq(mcpServers.id, serverId), eq(mcpServers.workspaceId, workspaceId)))
        .limit(1)

      if (existing) {
        await db
          .update(mcpServers)
          .set({
            name: config.name,
            transport: config.transport || 'streamable-http',
            url: config.url,
            headers: config.headers || {},
            timeout: config.timeout || 30000,
            enabled: config.enabled !== false,
            connectionStatus: 'connected',
            lastConnected: new Date(),
            updatedAt: new Date(),
            deletedAt: null,
          })
          .where(eq(mcpServers.id, serverId))
      } else {
        await db.insert(mcpServers).values({
          id: serverId,
          workspaceId,
          createdBy: context.userId,
          name: config.name,
          description: '',
          transport: config.transport || 'streamable-http',
          url: config.url,
          headers: config.headers || {},
          timeout: config.timeout || 30000,
          retries: 3,
          enabled: config.enabled !== false,
          connectionStatus: 'connected',
          lastConnected: new Date(),
          createdAt: new Date(),
          updatedAt: new Date(),
        })
      }

      await mcpService.clearCache(workspaceId)

      recordAudit({
        workspaceId,
        actorId: context.userId,
        action: AuditAction.MCP_SERVER_ADDED,
        resourceType: AuditResourceType.MCP_SERVER,
        resourceId: serverId,
        resourceName: config.name,
        description: existing
          ? `Updated existing MCP server "${config.name}"`
          : `Added MCP server "${config.name}"`,
      })

      return {
        success: true,
        output: {
          success: true,
          operation,
          serverId,
          name: config.name,
          message: existing
            ? `Updated existing MCP server "${config.name}"`
            : `Added MCP server "${config.name}"`,
        },
      }
    }

    if (operation === 'edit') {
      if (!params.serverId) {
        return { success: false, error: "'serverId' is required for 'edit'" }
      }
      const config = params.config
      if (!config) {
        return { success: false, error: "'config' is required for 'edit'" }
      }

      if (config.url) {
        validateMcpDomain(config.url)
      }

      const updateData: Record<string, unknown> = { updatedAt: new Date() }
      if (config.name !== undefined) updateData.name = config.name
      if (config.transport !== undefined) updateData.transport = config.transport
      if (config.url !== undefined) updateData.url = config.url
      if (config.headers !== undefined) updateData.headers = config.headers
      if (config.timeout !== undefined) updateData.timeout = config.timeout
      if (config.enabled !== undefined) updateData.enabled = config.enabled

      const [updated] = await db
        .update(mcpServers)
        .set(updateData)
        .where(
          and(
            eq(mcpServers.id, params.serverId),
            eq(mcpServers.workspaceId, workspaceId),
            isNull(mcpServers.deletedAt)
          )
        )
        .returning()

      if (!updated) {
        return { success: false, error: `MCP server not found: ${params.serverId}` }
      }

      await mcpService.clearCache(workspaceId)

      recordAudit({
        workspaceId,
        actorId: context.userId,
        action: AuditAction.MCP_SERVER_UPDATED,
        resourceType: AuditResourceType.MCP_SERVER,
        resourceId: params.serverId,
        description: `Updated MCP server "${updated.name}"`,
      })

      return {
        success: true,
        output: {
          success: true,
          operation,
          serverId: params.serverId,
          name: updated.name,
          message: `Updated MCP server "${updated.name}"`,
        },
      }
    }

    if (operation === 'delete') {
      if (context.userPermission && context.userPermission !== 'admin') {
        return {
          success: false,
          error: `Permission denied: 'delete' on manage_mcp_tool requires admin access. You have '${context.userPermission}' permission.`,
        }
      }

      if (!params.serverId) {
        return { success: false, error: "'serverId' is required for 'delete'" }
      }

      const [deleted] = await db
        .delete(mcpServers)
        .where(and(eq(mcpServers.id, params.serverId), eq(mcpServers.workspaceId, workspaceId)))
        .returning()

      if (!deleted) {
        return { success: false, error: `MCP server not found: ${params.serverId}` }
      }

      await mcpService.clearCache(workspaceId)

      recordAudit({
        workspaceId,
        actorId: context.userId,
        action: AuditAction.MCP_SERVER_REMOVED,
        resourceType: AuditResourceType.MCP_SERVER,
        resourceId: params.serverId,
        description: `Deleted MCP server "${deleted.name}"`,
      })

      return {
        success: true,
        output: {
          success: true,
          operation,
          serverId: params.serverId,
          message: `Deleted MCP server "${deleted.name}"`,
        },
      }
    }

    return { success: false, error: `Unsupported operation for manage_mcp_tool: ${operation}` }
  } catch (error) {
    logger
      .withMetadata({ messageId: context.messageId })
      .error('manage_mcp_tool execution failed', {
        operation,
        workspaceId,
        error: error instanceof Error ? error.message : String(error),
      })
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Failed to manage MCP server',
    }
  }
}

type ManageSkillOperation = 'add' | 'edit' | 'delete' | 'list'

interface ManageSkillParams {
  operation?: string
  skillId?: string
  name?: string
  description?: string
  content?: string
}

async function executeManageSkill(
  rawParams: Record<string, unknown>,
  context: ExecutionContext
): Promise<ToolCallResult> {
  const params = rawParams as ManageSkillParams
  const operation = String(params.operation || '').toLowerCase() as ManageSkillOperation
  const workspaceId = context.workspaceId

  if (!operation) {
    return { success: false, error: "Missing required 'operation' argument" }
  }

  if (!workspaceId) {
    return { success: false, error: 'workspaceId is required' }
  }

  const writeOps: string[] = ['add', 'edit', 'delete']
  if (
    writeOps.includes(operation) &&
    context.userPermission &&
    context.userPermission !== 'write' &&
    context.userPermission !== 'admin'
  ) {
    return {
      success: false,
      error: `Permission denied: '${operation}' on manage_skill requires write access. You have '${context.userPermission}' permission.`,
    }
  }

  try {
    if (operation === 'list') {
      const skills = await listSkills({ workspaceId })

      return {
        success: true,
        output: {
          success: true,
          operation,
          skills: skills.map((s) => ({
            id: s.id,
            name: s.name,
            description: s.description,
            createdAt: s.createdAt,
          })),
          count: skills.length,
        },
      }
    }

    if (operation === 'add') {
      if (!params.name || !params.description || !params.content) {
        return {
          success: false,
          error: "'name', 'description', and 'content' are required for 'add'",
        }
      }

      const resultSkills = await upsertSkills({
        skills: [{ name: params.name, description: params.description, content: params.content }],
        workspaceId,
        userId: context.userId,
      })
      const created = resultSkills.find((s) => s.name === params.name)

      recordAudit({
        workspaceId,
        actorId: context.userId,
        action: AuditAction.SKILL_CREATED,
        resourceType: AuditResourceType.SKILL,
        resourceId: created?.id,
        resourceName: params.name,
        description: `Created skill "${params.name}"`,
      })

      return {
        success: true,
        output: {
          success: true,
          operation,
          skillId: created?.id,
          name: params.name,
          message: `Created skill "${params.name}"`,
        },
      }
    }

    if (operation === 'edit') {
      if (!params.skillId) {
        return { success: false, error: "'skillId' is required for 'edit'" }
      }
      if (!params.name && !params.description && !params.content) {
        return {
          success: false,
          error: "At least one of 'name', 'description', or 'content' is required for 'edit'",
        }
      }

      const existing = await listSkills({ workspaceId })
      const found = existing.find((s) => s.id === params.skillId)
      if (!found) {
        return { success: false, error: `Skill not found: ${params.skillId}` }
      }

      await upsertSkills({
        skills: [
          {
            id: params.skillId,
            name: params.name || found.name,
            description: params.description || found.description,
            content: params.content || found.content,
          },
        ],
        workspaceId,
        userId: context.userId,
      })

      const updatedName = params.name || found.name

      recordAudit({
        workspaceId,
        actorId: context.userId,
        action: AuditAction.SKILL_UPDATED,
        resourceType: AuditResourceType.SKILL,
        resourceId: params.skillId,
        resourceName: updatedName,
        description: `Updated skill "${updatedName}"`,
      })

      return {
        success: true,
        output: {
          success: true,
          operation,
          skillId: params.skillId,
          name: updatedName,
          message: `Updated skill "${updatedName}"`,
        },
      }
    }

    if (operation === 'delete') {
      if (!params.skillId) {
        return { success: false, error: "'skillId' is required for 'delete'" }
      }

      const deleted = await deleteSkill({ skillId: params.skillId, workspaceId })
      if (!deleted) {
        return { success: false, error: `Skill not found: ${params.skillId}` }
      }

      recordAudit({
        workspaceId,
        actorId: context.userId,
        action: AuditAction.SKILL_DELETED,
        resourceType: AuditResourceType.SKILL,
        resourceId: params.skillId,
        description: 'Deleted skill',
      })

      return {
        success: true,
        output: {
          success: true,
          operation,
          skillId: params.skillId,
          message: 'Deleted skill',
        },
      }
    }

    return { success: false, error: `Unsupported operation for manage_skill: ${operation}` }
  } catch (error) {
    logger.withMetadata({ messageId: context.messageId }).error('manage_skill execution failed', {
      operation,
      workspaceId,
      error: error instanceof Error ? error.message : String(error),
    })
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Failed to manage skill',
    }
  }
}

const SERVER_TOOLS = new Set<string>([
  'get_blocks_metadata',
  'get_trigger_blocks',
  'edit_workflow',
  'get_workflow_logs',
  'search_documentation',
  'set_environment_variables',
  'make_api_request',
  'knowledge_base',
  'user_table',
  'workspace_file',
  'download_to_workspace_file',
  'get_execution_summary',
  'get_job_logs',
  'generate_visualization',
  'generate_image',
])

/**
 * Resolves a human-friendly provider name to a providerId and generates the
 * actual OAuth authorization URL via Better Auth's server-side API.
 *
 * Steps: resolve provider → create credential draft → look up user session →
 * call auth.api.oAuth2LinkAccount → return the real authorization URL.
 */
async function generateOAuthLink(
  userId: string,
  workspaceId: string | undefined,
  workflowId: string | undefined,
  chatId: string | undefined,
  providerName: string,
  baseUrl: string
): Promise<{ url: string; providerId: string; serviceName: string }> {
  if (!workspaceId) {
    throw new Error('workspaceId is required to generate an OAuth link')
  }

  const allServices = getAllOAuthServices()
  const normalizedInput = providerName.toLowerCase().trim()

  const matched =
    allServices.find((s) => s.providerId === normalizedInput) ||
    allServices.find((s) => s.name.toLowerCase() === normalizedInput) ||
    allServices.find(
      (s) =>
        s.name.toLowerCase().includes(normalizedInput) ||
        normalizedInput.includes(s.name.toLowerCase())
    ) ||
    allServices.find(
      (s) => s.providerId.includes(normalizedInput) || normalizedInput.includes(s.providerId)
    )

  if (!matched) {
    const available = allServices.map((s) => s.name).join(', ')
    throw new Error(`Provider "${providerName}" not found. Available providers: ${available}`)
  }

  const { providerId, name: serviceName } = matched
  const callbackURL =
    workflowId && workspaceId
      ? `${baseUrl}/workspace/${workspaceId}/w/${workflowId}`
      : chatId && workspaceId
        ? `${baseUrl}/workspace/${workspaceId}/task/${chatId}`
        : `${baseUrl}/workspace/${workspaceId}`

  // Trello and Shopify use custom auth routes, not genericOAuth
  if (providerId === 'trello') {
    return { url: `${baseUrl}/api/auth/trello/authorize`, providerId, serviceName }
  }
  if (providerId === 'shopify') {
    const returnUrl = encodeURIComponent(callbackURL)
    return {
      url: `${baseUrl}/api/auth/shopify/authorize?returnUrl=${returnUrl}`,
      providerId,
      serviceName,
    }
  }

  // Build display name: "User Name's ServiceName" or just "ServiceName"
  let displayName = serviceName
  try {
    const [row] = await db.select({ name: user.name }).from(user).where(eq(user.id, userId))
    if (row?.name) {
      displayName = `${row.name}'s ${serviceName}`
    }
  } catch {
    // Fall back to service name only
  }

  // Create credential draft so the callback hook creates the credential
  const now = new Date()
  await db
    .delete(pendingCredentialDraft)
    .where(
      and(eq(pendingCredentialDraft.userId, userId), lt(pendingCredentialDraft.expiresAt, now))
    )
  await db
    .insert(pendingCredentialDraft)
    .values({
      id: generateId(),
      userId,
      workspaceId,
      providerId,
      displayName,
      expiresAt: new Date(now.getTime() + 15 * 60 * 1000),
      createdAt: now,
    })
    .onConflictDoUpdate({
      target: [
        pendingCredentialDraft.userId,
        pendingCredentialDraft.providerId,
        pendingCredentialDraft.workspaceId,
      ],
      set: {
        displayName,
        expiresAt: new Date(now.getTime() + 15 * 60 * 1000),
        createdAt: now,
      },
    })

  const { auth } = await import('@/lib/auth/auth')
  const { headers: getHeaders } = await import('next/headers')
  const reqHeaders = await getHeaders()

  const data = await auth.api.oAuth2LinkAccount({
    body: { providerId, callbackURL },
    headers: reqHeaders,
  })

  if (!data?.url) {
    throw new Error('oAuth2LinkAccount did not return an authorization URL')
  }

  return { url: data.url, providerId, serviceName }
}

const SIM_WORKFLOW_TOOL_HANDLERS: Record<
  string,
  (params: Record<string, unknown>, context: ExecutionContext) => Promise<ToolCallResult>
> = {
  list_user_workspaces: (_p, c) => executeListUserWorkspaces(c),
  list_folders: (p, c) => executeListFolders(p as ListFoldersParams, c),
  create_workflow: (p, c) => executeCreateWorkflow(p as CreateWorkflowParams, c),
  create_folder: (p, c) => executeCreateFolder(p as CreateFolderParams, c),
  rename_workflow: (p, c) => executeRenameWorkflow(p as unknown as RenameWorkflowParams, c),
  update_workflow: (p, c) => executeUpdateWorkflow(p as unknown as UpdateWorkflowParams, c),
  delete_workflow: (p, c) => executeDeleteWorkflow(p as unknown as DeleteWorkflowParams, c),
  move_workflow: (p, c) => executeMoveWorkflow(p as unknown as MoveWorkflowParams, c),
  move_folder: (p, c) => executeMoveFolder(p as unknown as MoveFolderParams, c),
  rename_folder: (p, c) => executeRenameFolder(p as unknown as RenameFolderParams, c),
  delete_folder: (p, c) => executeDeleteFolder(p as unknown as DeleteFolderParams, c),
  get_workflow_data: (p, c) => executeGetWorkflowData(p as GetWorkflowDataParams, c),
  get_block_outputs: (p, c) => executeGetBlockOutputs(p as GetBlockOutputsParams, c),
  get_block_upstream_references: (p, c) =>
    executeGetBlockUpstreamReferences(p as unknown as GetBlockUpstreamReferencesParams, c),
  run_workflow: (p, c) => executeRunWorkflow(p as RunWorkflowParams, c),
  run_workflow_until_block: (p, c) =>
    executeRunWorkflowUntilBlock(p as unknown as RunWorkflowUntilBlockParams, c),
  run_from_block: (p, c) => executeRunFromBlock(p as unknown as RunFromBlockParams, c),
  run_block: (p, c) => executeRunBlock(p as unknown as RunBlockParams, c),
  get_deployed_workflow_state: (p, c) =>
    executeGetDeployedWorkflowState(p as GetDeployedWorkflowStateParams, c),
  generate_api_key: (p, c) => executeGenerateApiKey(p as unknown as GenerateApiKeyParams, c),
  get_platform_actions: () =>
    Promise.resolve({
      success: true,
      output: { content: PLATFORM_ACTIONS_CONTENT },
    }),
  set_global_workflow_variables: (p, c) =>
    executeSetGlobalWorkflowVariables(p as SetGlobalWorkflowVariablesParams, c),
  deploy_api: (p, c) => executeDeployApi(p as DeployApiParams, c),
  deploy_chat: (p, c) => executeDeployChat(p as DeployChatParams, c),
  deploy_mcp: (p, c) => executeDeployMcp(p as DeployMcpParams, c),
  redeploy: (p, c) => executeRedeploy(p as { workflowId?: string }, c),
  check_deployment_status: (p, c) =>
    executeCheckDeploymentStatus(p as CheckDeploymentStatusParams, c),
  list_workspace_mcp_servers: (p, c) =>
    executeListWorkspaceMcpServers(p as ListWorkspaceMcpServersParams, c),
  create_workspace_mcp_server: (p, c) =>
    executeCreateWorkspaceMcpServer(p as CreateWorkspaceMcpServerParams, c),
  update_workspace_mcp_server: (p, c) =>
    executeUpdateWorkspaceMcpServer(p as unknown as UpdateWorkspaceMcpServerParams, c),
  delete_workspace_mcp_server: (p, c) =>
    executeDeleteWorkspaceMcpServer(p as unknown as DeleteWorkspaceMcpServerParams, c),
  get_deployment_version: (p, c) =>
    executeGetDeploymentVersion(p as { workflowId?: string; version?: number }, c),
  revert_to_version: (p, c) =>
    executeRevertToVersion(p as { workflowId?: string; version?: number }, c),
  manage_credential: async (p, c) => {
    const params = p as { operation: string; credentialId: string; displayName?: string }
    const { operation, credentialId, displayName } = params
    if (!credentialId) {
      return { success: false, error: 'credentialId is required' }
    }
    try {
      const [row] = await db
        .select({ id: credential.id, type: credential.type, displayName: credential.displayName })
        .from(credential)
        .where(eq(credential.id, credentialId))
        .limit(1)
      if (!row) {
        return { success: false, error: 'Credential not found' }
      }
      if (row.type !== 'oauth') {
        return {
          success: false,
          error:
            'Only OAuth credentials can be managed with this tool. Use set_environment_variables for env vars.',
        }
      }
      switch (operation) {
        case 'rename': {
          if (!displayName) {
            return { success: false, error: 'displayName is required for rename' }
          }
          await db
            .update(credential)
            .set({ displayName, updatedAt: new Date() })
            .where(eq(credential.id, credentialId))
          recordAudit({
            actorId: c.userId,
            action: AuditAction.CREDENTIAL_RENAMED,
            resourceType: AuditResourceType.OAUTH,
            resourceId: credentialId,
            description: `Renamed credential to "${displayName}"`,
          })
          return { success: true, output: { credentialId, displayName } }
        }
        case 'delete': {
          await db.delete(credential).where(eq(credential.id, credentialId))
          recordAudit({
            actorId: c.userId,
            action: AuditAction.CREDENTIAL_DELETED,
            resourceType: AuditResourceType.OAUTH,
            resourceId: credentialId,
            description: `Deleted credential`,
          })
          return { success: true, output: { credentialId, deleted: true } }
        }
        default:
          return {
            success: false,
            error: `Unknown operation: ${operation}. Use "rename" or "delete".`,
          }
      }
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : String(error) }
    }
  },
  create_job: (p, c) => executeCreateJob(p, c),
  manage_job: (p, c) => executeManageJob(p, c),
  complete_job: (p, c) => executeCompleteJob(p, c),
  update_job_history: (p, c) => executeUpdateJobHistory(p, c),
  oauth_get_auth_link: async (p, c) => {
    const providerName = (p.providerName || p.provider_name || 'the provider') as string
    const baseUrl = getBaseUrl()

    try {
      const result = await generateOAuthLink(
        c.userId,
        c.workspaceId,
        c.workflowId,
        c.chatId,
        providerName,
        baseUrl
      )
      return {
        success: true,
        output: {
          message: `Authorization URL generated for ${result.serviceName}. The user must open this URL in a browser to authorize.`,
          oauth_url: result.url,
          instructions: `Open this URL in your browser to connect ${result.serviceName}: ${result.url}`,
          provider: result.serviceName,
          providerId: result.providerId,
        },
      }
    } catch (err) {
      logger
        .withMetadata({ messageId: c.messageId })
        .warn('Failed to generate OAuth link, falling back to generic URL', {
          providerName,
          error: err instanceof Error ? err.message : String(err),
        })
      const workspaceUrl = c.workspaceId
        ? `${baseUrl}/workspace/${c.workspaceId}`
        : `${baseUrl}/workspace`
      return {
        success: false,
        output: {
          message: `Could not generate a direct OAuth link for ${providerName}. The user can connect manually from the workspace.`,
          oauth_url: workspaceUrl,
          instructions: `Open ${workspaceUrl} in a browser, go to Settings → Credentials, and connect ${providerName} from there.`,
          provider: providerName,
          error: err instanceof Error ? err.message : String(err),
        },
      }
    }
  },
  oauth_request_access: async (p, _c) => {
    const providerName = (p.providerName || p.provider_name || 'the provider') as string
    return {
      success: true,
      output: {
        success: true,
        status: 'requested',
        providerName,
        message: `Requested ${providerName} OAuth connection. The user should complete the OAuth modal in the UI, then retry credential-dependent actions.`,
      },
    }
  },
  materialize_file: (p, c) => executeMaterializeFile(p, c),
  manage_custom_tool: (p, c) => executeManageCustomTool(p, c),
  manage_mcp_tool: (p, c) => executeManageMcpTool(p, c),
  manage_skill: (p, c) => executeManageSkill(p, c),
  // VFS tools
  grep: (p, c) => executeVfsGrep(p, c),
  glob: (p, c) => executeVfsGlob(p, c),
  read: (p, c) => executeVfsRead(p, c),
  list: (p, c) => executeVfsList(p, c),

  // Resource visibility
  open_resource: async (p: OpenResourceParams, c: ExecutionContext) => {
    const validated = validateOpenResourceParams(p)
    if (!validated.success) {
      return { success: false, error: validated.error }
    }

    const params = validated.params
    const resourceType = params.type
    let resourceId = params.id
    let title: string = resourceType

    if (resourceType === 'file') {
      if (!c.workspaceId) {
        return {
          success: false,
          error:
            'Opening a workspace file requires workspace context. Pass the canonical file UUID from files/by-id/<fileId>/meta.json.',
        }
      }
      if (!isUuid(params.id)) {
        return {
          success: false,
          error:
            'open_resource for files requires the canonical file UUID. Read files/by-id/<fileId>/meta.json or files/<name>/meta.json and pass the "id" field. Do not pass VFS paths or display names.',
        }
      }
      const record = await getWorkspaceFile(c.workspaceId, params.id)
      if (!record) {
        return {
          success: false,
          error: `No workspace file with id "${params.id}". Confirm the UUID from files/by-id/<fileId>/meta.json.`,
        }
      }
      resourceId = record.id
      title = record.name
    }

    if (resourceType === 'workflow') {
      const workflow = await getWorkflowById(params.id)
      if (!workflow) {
        return {
          success: false,
          error: `No workflow with id "${params.id}". Confirm the workflow ID before opening it.`,
        }
      }
      if (c.workspaceId && workflow.workspaceId !== c.workspaceId) {
        return {
          success: false,
          error: `Workflow "${params.id}" was not found in the current workspace.`,
        }
      }
      resourceId = workflow.id
      title = workflow.name
    }

    if (resourceType === 'table') {
      const table = await getTableById(params.id)
      if (!table) {
        return {
          success: false,
          error: `No table with id "${params.id}". Confirm the table ID before opening it.`,
        }
      }
      if (c.workspaceId && table.workspaceId !== c.workspaceId) {
        return {
          success: false,
          error: `Table "${params.id}" was not found in the current workspace.`,
        }
      }
      resourceId = table.id
      title = table.name
    }

    if (resourceType === 'knowledgebase') {
      const knowledgeBase = await getKnowledgeBaseById(params.id)
      if (!knowledgeBase) {
        return {
          success: false,
          error: `No knowledge base with id "${params.id}". Confirm the knowledge base ID before opening it.`,
        }
      }
      if (c.workspaceId && knowledgeBase.workspaceId !== c.workspaceId) {
        return {
          success: false,
          error: `Knowledge base "${params.id}" was not found in the current workspace.`,
        }
      }
      resourceId = knowledgeBase.id
      title = knowledgeBase.name
    }

    return {
      success: true,
      output: { message: `Opened ${resourceType} ${resourceId} for the user` },
      resources: [
        {
          type: resourceType as 'workflow' | 'table' | 'knowledgebase' | 'file',
          id: resourceId,
          title,
        },
      ],
    }
  },
}

/**
 * Check whether a tool can be executed on the Sim (TypeScript) side.
 *
 * Tools that are only available server-side (e.g. search_patterns)
 * will return false.  The subagent tool_call
 * handler uses this to decide whether to execute a tool locally or let the
 * server's own tool_result SSE event handle it.
 */
export function isToolAvailableOnSimSide(toolName: string): boolean {
  if (SERVER_TOOLS.has(toolName)) return true
  if (toolName in SIM_WORKFLOW_TOOL_HANDLERS) return true
  if (isMcpTool(toolName)) return true
  const resolvedToolName = resolveToolId(toolName)
  return !!getTool(resolvedToolName)
}

/**
 * Execute a tool server-side without calling internal routes.
 */
export async function executeToolServerSide(
  toolCall: ToolCallState,
  context: ExecutionContext
): Promise<ToolCallResult> {
  const toolName = toolCall.name
  const resolvedToolName = resolveToolId(toolName)

  if (SERVER_TOOLS.has(toolName)) {
    return executeServerToolDirect(toolName, toolCall.params || {}, context)
  }

  if (toolName in SIM_WORKFLOW_TOOL_HANDLERS) {
    return executeSimWorkflowTool(toolName, toolCall.params || {}, context)
  }

  if (isMcpTool(toolName)) {
    return executeMcpToolDirect(toolCall, context)
  }

  const toolConfig = getTool(resolvedToolName)
  if (!toolConfig) {
    logger
      .withMetadata({ messageId: context.messageId })
      .warn('Tool not found in registry', { toolName, resolvedToolName })
    return {
      success: false,
      error: `Tool not found: ${toolName}`,
    }
  }

  return executeIntegrationToolDirect(toolCall, toolConfig, context)
}

/**
 * Execute an MCP tool via the existing executeTool dispatcher which
 * already handles the mcp- prefix and routes to /api/mcp/tools/execute.
 */
async function executeMcpToolDirect(
  toolCall: ToolCallState,
  context: ExecutionContext
): Promise<ToolCallResult> {
  const { userId, workflowId } = context

  let workspaceId = context.workspaceId
  if (!workspaceId && workflowId) {
    const wf = await getWorkflowById(workflowId)
    workspaceId = wf?.workspaceId ?? undefined
  }

  const params: Record<string, unknown> = {
    ...(toolCall.params || {}),
    _context: { workflowId, userId, workspaceId },
  }

  const result = await executeTool(toolCall.name, params)

  return {
    success: result.success,
    output: result.output,
    error: result.error,
  }
}

/**
 * Execute a server tool directly via the server tool router.
 */
async function executeServerToolDirect(
  toolName: string,
  params: Record<string, unknown>,
  context: ExecutionContext
): Promise<ToolCallResult> {
  try {
    const enrichedParams = { ...params }
    if (!enrichedParams.workflowId && context.workflowId) {
      enrichedParams.workflowId = context.workflowId
    }
    if (!enrichedParams.workspaceId && context.workspaceId) {
      enrichedParams.workspaceId = context.workspaceId
    }

    const result = await routeExecution(toolName, enrichedParams, {
      userId: context.userId,
      workspaceId: context.workspaceId,
      userPermission: context.userPermission,
      chatId: context.chatId,
      messageId: context.messageId,
      abortSignal: context.abortSignal,
      userStopSignal: context.userStopSignal,
    })

    const resultRecord =
      result && typeof result === 'object' && !Array.isArray(result)
        ? (result as Record<string, unknown>)
        : null

    // Some server tools return an explicit { success, message, ... } envelope.
    // Preserve tool-level failures instead of reporting them as transport success.
    if (resultRecord?.success === false) {
      const message =
        (typeof resultRecord.error === 'string' && resultRecord.error) ||
        (typeof resultRecord.message === 'string' && resultRecord.message) ||
        `${toolName} failed`

      return {
        success: false,
        error: message,
        output: result,
      }
    }

    return { success: true, output: result }
  } catch (error) {
    logger.withMetadata({ messageId: context.messageId }).error('Server tool execution failed', {
      toolName,
      error: error instanceof Error ? error.message : String(error),
    })
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Server tool execution failed',
    }
  }
}

async function executeSimWorkflowTool(
  toolName: string,
  params: Record<string, unknown>,
  context: ExecutionContext
): Promise<ToolCallResult> {
  const handler = SIM_WORKFLOW_TOOL_HANDLERS[toolName]
  if (!handler) return { success: false, error: `Unsupported workflow tool: ${toolName}` }

  if (context.workflowId) {
    if (toolName === 'create_workflow') {
      return {
        success: false,
        error:
          'Cannot create new workflows from the workflow copilot. You are scoped to the current workflow. Use the workspace chat to create new workflows.',
      }
    }

    if (
      toolName === 'edit_workflow' &&
      params.workflowId &&
      params.workflowId !== context.workflowId
    ) {
      return {
        success: false,
        error: `Cannot edit a different workflow. You are scoped to workflow ${context.workflowId}.`,
      }
    }
  }

  return handler(params, context)
}

/** Timeout for the mark-complete POST to the copilot backend (30 s). */
const MARK_COMPLETE_TIMEOUT_MS = 30_000

/**
 * Notify the copilot backend that a tool has completed.
 */
export async function markToolComplete(
  toolCallId: string,
  toolName: string,
  status: number,
  message?: unknown,
  data?: unknown,
  messageId?: string
): Promise<boolean> {
  try {
    const controller = new AbortController()
    const timeoutId = setTimeout(() => controller.abort(), MARK_COMPLETE_TIMEOUT_MS)

    try {
      const response = await fetch(`${SIM_AGENT_API_URL}/api/tools/mark-complete`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(env.COPILOT_API_KEY ? { 'x-api-key': env.COPILOT_API_KEY } : {}),
        },
        body: JSON.stringify({
          id: toolCallId,
          name: toolName,
          status,
          message,
          data,
        }),
        signal: controller.signal,
      })

      if (!response.ok) {
        logger.withMetadata({ messageId }).warn('Mark-complete call failed', {
          toolCallId,
          toolName,
          status: response.status,
        })
        return false
      }

      return true
    } finally {
      clearTimeout(timeoutId)
    }
  } catch (error) {
    const isTimeout = error instanceof DOMException && error.name === 'AbortError'
    logger.withMetadata({ messageId }).error('Mark-complete call failed', {
      toolCallId,
      toolName,
      timedOut: isTimeout,
      error: error instanceof Error ? error.message : String(error),
    })
    return false
  }
}

/**
 * Prepare execution context with cached environment values.
 */
export async function prepareExecutionContext(
  userId: string,
  workflowId: string,
  chatId?: string
): Promise<ExecutionContext> {
  const wf = await getWorkflowById(workflowId)
  const workspaceId = wf?.workspaceId ?? undefined

  const decryptedEnvVars = await getEffectiveDecryptedEnv(userId, workspaceId)

  return {
    userId,
    workflowId,
    workspaceId,
    chatId,
    decryptedEnvVars,
  }
}
