import { db } from '@sim/db'
import { customTools, workflow } from '@sim/db/schema'
import { createLogger } from '@sim/logger'
import { and, desc, eq, isNull, or } from 'drizzle-orm'
import { SIM_AGENT_API_URL } from '@/lib/copilot/constants'
import type {
  ExecutionContext,
  ToolCallResult,
  ToolCallState,
} from '@/lib/copilot/orchestrator/types'
import { routeExecution } from '@/lib/copilot/tools/server/router'
import { env } from '@/lib/core/config/env'
import { getBaseUrl } from '@/lib/core/utils/urls'
import { getEffectiveDecryptedEnv } from '@/lib/environment/utils'
import { upsertCustomTools } from '@/lib/workflows/custom-tools/operations'
import { getTool, resolveToolId } from '@/tools/utils'
import {
  executeCheckDeploymentStatus,
  executeCreateWorkspaceMcpServer,
  executeDeployApi,
  executeDeployChat,
  executeDeployMcp,
  executeListWorkspaceMcpServers,
  executeRedeploy,
} from './deployment-tools'
import { executeIntegrationToolDirect } from './integration-tools'
import type {
  CheckDeploymentStatusParams,
  CreateFolderParams,
  CreateWorkflowParams,
  CreateWorkspaceMcpServerParams,
  DeployApiParams,
  DeployChatParams,
  DeployMcpParams,
  GenerateApiKeyParams,
  GetBlockOutputsParams,
  GetBlockUpstreamReferencesParams,
  GetDeployedWorkflowStateParams,
  GetUserWorkflowParams,
  GetWorkflowDataParams,
  GetWorkflowFromNameParams,
  ListFoldersParams,
  ListUserWorkflowsParams,
  ListWorkspaceMcpServersParams,
  MoveFolderParams,
  MoveWorkflowParams,
  RenameWorkflowParams,
  RunBlockParams,
  RunFromBlockParams,
  RunWorkflowParams,
  RunWorkflowUntilBlockParams,
  SetGlobalWorkflowVariablesParams,
} from './param-types'
import { PLATFORM_ACTIONS_CONTENT } from './platform-actions'
import {
  executeCreateFolder,
  executeCreateWorkflow,
  executeGenerateApiKey,
  executeGetBlockOutputs,
  executeGetBlockUpstreamReferences,
  executeGetDeployedWorkflowState,
  executeGetUserWorkflow,
  executeGetWorkflowData,
  executeGetWorkflowFromName,
  executeListFolders,
  executeListUserWorkflows,
  executeListUserWorkspaces,
  executeMoveFolder,
  executeMoveWorkflow,
  executeRenameWorkflow,
  executeRunBlock,
  executeRunFromBlock,
  executeRunWorkflow,
  executeRunWorkflowUntilBlock,
  executeSetGlobalWorkflowVariables,
} from './workflow-tools'

const logger = createLogger('CopilotToolExecutor')

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

  try {
    if (operation === 'list') {
      const toolsForUser = workspaceId
        ? await db
            .select()
            .from(customTools)
            .where(
              or(
                eq(customTools.workspaceId, workspaceId),
                and(isNull(customTools.workspaceId), eq(customTools.userId, context.userId))
              )
            )
            .orderBy(desc(customTools.createdAt))
        : await db
            .select()
            .from(customTools)
            .where(and(isNull(customTools.workspaceId), eq(customTools.userId, context.userId)))
            .orderBy(desc(customTools.createdAt))

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
        tools: [
          {
            title,
            schema: params.schema,
            code: params.code,
          },
        ],
        workspaceId,
        userId: context.userId,
      })
      const created = resultTools.find((tool) => tool.title === title)

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

      const workspaceTool = await db
        .select()
        .from(customTools)
        .where(and(eq(customTools.id, params.toolId), eq(customTools.workspaceId, workspaceId)))
        .limit(1)

      const legacyTool =
        workspaceTool.length === 0
          ? await db
              .select()
              .from(customTools)
              .where(
                and(
                  eq(customTools.id, params.toolId),
                  isNull(customTools.workspaceId),
                  eq(customTools.userId, context.userId)
                )
              )
              .limit(1)
          : []

      const existing = workspaceTool[0] || legacyTool[0]
      if (!existing) {
        return { success: false, error: `Custom tool not found: ${params.toolId}` }
      }

      const mergedSchema = params.schema || (existing.schema as ManageCustomToolSchema)
      const mergedCode = params.code || existing.code
      const title = params.title || mergedSchema.function?.name || existing.title

      await upsertCustomTools({
        tools: [
          {
            id: params.toolId,
            title,
            schema: mergedSchema,
            code: mergedCode,
          },
        ],
        workspaceId,
        userId: context.userId,
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

      const workspaceDelete =
        workspaceId != null
          ? await db
              .delete(customTools)
              .where(and(eq(customTools.id, params.toolId), eq(customTools.workspaceId, workspaceId)))
              .returning({ id: customTools.id })
          : []

      const legacyDelete =
        workspaceDelete.length === 0
          ? await db
              .delete(customTools)
              .where(
                and(
                  eq(customTools.id, params.toolId),
                  isNull(customTools.workspaceId),
                  eq(customTools.userId, context.userId)
                )
              )
              .returning({ id: customTools.id })
          : []

      const deleted = workspaceDelete[0] || legacyDelete[0]
      if (!deleted) {
        return { success: false, error: `Custom tool not found: ${params.toolId}` }
      }

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
    logger.error('manage_custom_tool execution failed', {
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

const SERVER_TOOLS = new Set<string>([
  'get_blocks_and_tools',
  'get_blocks_metadata',
  'get_block_options',
  'get_block_config',
  'get_trigger_blocks',
  'edit_workflow',
  'get_workflow_console',
  'search_documentation',
  'search_online',
  'set_environment_variables',
  'get_credentials',
  'make_api_request',
  'knowledge_base',
])

const SIM_WORKFLOW_TOOL_HANDLERS: Record<
  string,
  (params: Record<string, unknown>, context: ExecutionContext) => Promise<ToolCallResult>
> = {
  get_user_workflow: (p, c) => executeGetUserWorkflow(p as GetUserWorkflowParams, c),
  get_workflow_from_name: (p, c) => executeGetWorkflowFromName(p as GetWorkflowFromNameParams, c),
  list_user_workflows: (p, c) => executeListUserWorkflows(p as ListUserWorkflowsParams, c),
  list_user_workspaces: (_p, c) => executeListUserWorkspaces(c),
  list_folders: (p, c) => executeListFolders(p as ListFoldersParams, c),
  create_workflow: (p, c) => executeCreateWorkflow(p as CreateWorkflowParams, c),
  create_folder: (p, c) => executeCreateFolder(p as CreateFolderParams, c),
  rename_workflow: (p, c) => executeRenameWorkflow(p as unknown as RenameWorkflowParams, c),
  move_workflow: (p, c) => executeMoveWorkflow(p as unknown as MoveWorkflowParams, c),
  move_folder: (p, c) => executeMoveFolder(p as unknown as MoveFolderParams, c),
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
  redeploy: (_p, c) => executeRedeploy(c),
  check_deployment_status: (p, c) =>
    executeCheckDeploymentStatus(p as CheckDeploymentStatusParams, c),
  list_workspace_mcp_servers: (p, c) =>
    executeListWorkspaceMcpServers(p as ListWorkspaceMcpServersParams, c),
  create_workspace_mcp_server: (p, c) =>
    executeCreateWorkspaceMcpServer(p as CreateWorkspaceMcpServerParams, c),
  oauth_get_auth_link: async (p, _c) => {
    const providerName = (p.providerName || p.provider_name || 'the provider') as string
    try {
      const baseUrl = getBaseUrl()
      const settingsUrl = `${baseUrl}/workspace`
      return {
        success: true,
        output: {
          message: `To connect ${providerName}, the user must authorize via their browser.`,
          oauth_url: settingsUrl,
          instructions: `Open ${settingsUrl} in a browser and go to the workflow editor to connect ${providerName} credentials.`,
          provider: providerName,
          baseUrl,
        },
      }
    } catch {
      return {
        success: true,
        output: {
          message: `To connect ${providerName}, the user must authorize via their browser.`,
          instructions: `Open the Sim workspace in a browser and go to the workflow editor to connect ${providerName} credentials.`,
          provider: providerName,
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
  manage_custom_tool: (p, c) => executeManageCustomTool(p, c),
}

/**
 * Check whether a tool can be executed on the Sim (TypeScript) side.
 *
 * Tools that are only available on the Go backend (e.g. search_patterns,
 * search_errors, remember_debug) will return false.  The subagent tool_call
 * handler uses this to decide whether to execute a tool locally or let the
 * Go backend's own tool_result SSE event handle it.
 */
export function isToolAvailableOnSimSide(toolName: string): boolean {
  if (SERVER_TOOLS.has(toolName)) return true
  if (toolName in SIM_WORKFLOW_TOOL_HANDLERS) return true
  const resolvedToolName = resolveToolId(toolName)
  return !!getTool(resolvedToolName)
}

/**
 * Check whether a tool is a user-installed integration tool (e.g. Gmail, Slack).
 * These tools exist in the tool registry but are NOT copilot server tools or
 * known workflow manipulation tools. They should require user approval in
 * interactive mode.
 */
export function isIntegrationTool(toolName: string): boolean {
  if (SERVER_TOOLS.has(toolName)) return false
  if (toolName in SIM_WORKFLOW_TOOL_HANDLERS) return false
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

  const toolConfig = getTool(resolvedToolName)
  if (!toolConfig) {
    logger.warn('Tool not found in registry', { toolName, resolvedToolName })
    return {
      success: false,
      error: `Tool not found: ${toolName}`,
    }
  }

  return executeIntegrationToolDirect(toolCall, toolConfig, context)
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
    // Inject workflowId from context if not provided in params
    // This is needed for tools like set_environment_variables that require workflowId
    const enrichedParams = { ...params }
    if (!enrichedParams.workflowId && context.workflowId) {
      enrichedParams.workflowId = context.workflowId
    }

    const result = await routeExecution(toolName, enrichedParams, { userId: context.userId })
    return { success: true, output: result }
  } catch (error) {
    logger.error('Server tool execution failed', {
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
  data?: unknown
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
        logger.warn('Mark-complete call failed', { toolCallId, toolName, status: response.status })
        return false
      }

      return true
    } finally {
      clearTimeout(timeoutId)
    }
  } catch (error) {
    const isTimeout = error instanceof DOMException && error.name === 'AbortError'
    logger.error('Mark-complete call failed', {
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
  workflowId: string
): Promise<ExecutionContext> {
  const workflowResult = await db
    .select({ workspaceId: workflow.workspaceId })
    .from(workflow)
    .where(eq(workflow.id, workflowId))
    .limit(1)
  const workspaceId = workflowResult[0]?.workspaceId ?? undefined

  const decryptedEnvVars = await getEffectiveDecryptedEnv(userId, workspaceId)

  return {
    userId,
    workflowId,
    workspaceId,
    decryptedEnvVars,
  }
}
