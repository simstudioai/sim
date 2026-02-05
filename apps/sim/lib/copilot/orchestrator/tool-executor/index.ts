import { db } from '@sim/db'
import { workflow } from '@sim/db/schema'
import { createLogger } from '@sim/logger'
import { eq } from 'drizzle-orm'
import { SIM_AGENT_API_URL } from '@/lib/copilot/constants'
import type {
  ExecutionContext,
  ToolCallResult,
  ToolCallState,
} from '@/lib/copilot/orchestrator/types'
import { routeExecution } from '@/lib/copilot/tools/server/router'
import { env } from '@/lib/core/config/env'
import { getEffectiveDecryptedEnv } from '@/lib/environment/utils'
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
  GetBlockOutputsParams,
  GetBlockUpstreamReferencesParams,
  GetUserWorkflowParams,
  GetWorkflowDataParams,
  GetWorkflowFromNameParams,
  ListFoldersParams,
  ListUserWorkflowsParams,
  ListWorkspaceMcpServersParams,
  RunWorkflowParams,
  SetGlobalWorkflowVariablesParams,
} from './param-types'
import {
  executeCreateFolder,
  executeCreateWorkflow,
  executeGetBlockOutputs,
  executeGetBlockUpstreamReferences,
  executeGetUserWorkflow,
  executeGetWorkflowData,
  executeGetWorkflowFromName,
  executeListFolders,
  executeListUserWorkflows,
  executeListUserWorkspaces,
  executeRunWorkflow,
  executeSetGlobalWorkflowVariables,
} from './workflow-tools'

const logger = createLogger('CopilotToolExecutor')

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

const SIM_WORKFLOW_TOOLS = new Set<string>([
  'get_user_workflow',
  'get_workflow_from_name',
  'list_user_workflows',
  'list_user_workspaces',
  'list_folders',
  'create_workflow',
  'create_folder',
  'get_workflow_data',
  'get_block_outputs',
  'get_block_upstream_references',
  'run_workflow',
  'set_global_workflow_variables',
  'deploy_api',
  'deploy_chat',
  'deploy_mcp',
  'redeploy',
  'check_deployment_status',
  'list_workspace_mcp_servers',
  'create_workspace_mcp_server',
])

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

  if (SIM_WORKFLOW_TOOLS.has(toolName)) {
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
  params: Record<string, any>,
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
  params: Record<string, any>,
  context: ExecutionContext
): Promise<ToolCallResult> {
  switch (toolName) {
    case 'get_user_workflow':
      return executeGetUserWorkflow(params as GetUserWorkflowParams, context)
    case 'get_workflow_from_name':
      return executeGetWorkflowFromName(params as GetWorkflowFromNameParams, context)
    case 'list_user_workflows':
      return executeListUserWorkflows(params as ListUserWorkflowsParams, context)
    case 'list_user_workspaces':
      return executeListUserWorkspaces(context)
    case 'list_folders':
      return executeListFolders(params as ListFoldersParams, context)
    case 'create_workflow':
      return executeCreateWorkflow(params as CreateWorkflowParams, context)
    case 'create_folder':
      return executeCreateFolder(params as CreateFolderParams, context)
    case 'get_workflow_data':
      return executeGetWorkflowData(params as GetWorkflowDataParams, context)
    case 'get_block_outputs':
      return executeGetBlockOutputs(params as GetBlockOutputsParams, context)
    case 'get_block_upstream_references':
      return executeGetBlockUpstreamReferences(params as GetBlockUpstreamReferencesParams, context)
    case 'run_workflow':
      return executeRunWorkflow(params as RunWorkflowParams, context)
    case 'set_global_workflow_variables':
      return executeSetGlobalWorkflowVariables(params as SetGlobalWorkflowVariablesParams, context)
    case 'deploy_api':
      return executeDeployApi(params as DeployApiParams, context)
    case 'deploy_chat':
      return executeDeployChat(params as DeployChatParams, context)
    case 'deploy_mcp':
      return executeDeployMcp(params as DeployMcpParams, context)
    case 'redeploy':
      return executeRedeploy(context)
    case 'check_deployment_status':
      return executeCheckDeploymentStatus(params as CheckDeploymentStatusParams, context)
    case 'list_workspace_mcp_servers':
      return executeListWorkspaceMcpServers(params as ListWorkspaceMcpServersParams, context)
    case 'create_workspace_mcp_server':
      return executeCreateWorkspaceMcpServer(params as CreateWorkspaceMcpServerParams, context)
    default:
      return { success: false, error: `Unsupported workflow tool: ${toolName}` }
  }
}

/**
 * Notify the copilot backend that a tool has completed.
 */
export async function markToolComplete(
  toolCallId: string,
  toolName: string,
  status: number,
  message?: any,
  data?: any
): Promise<boolean> {
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
    })

    if (!response.ok) {
      logger.warn('Mark-complete call failed', { toolCallId, status: response.status })
      return false
    }

    return true
  } catch (error) {
    logger.error('Mark-complete call failed', {
      toolCallId,
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
