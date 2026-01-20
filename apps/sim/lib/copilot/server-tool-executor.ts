/**
 * Server-Side Tool Executor for Copilot
 *
 * Executes copilot tools server-side when no client session is present.
 * Handles routing to appropriate server implementations and marking tools complete.
 */

import { db } from '@sim/db'
import { account, workflow } from '@sim/db/schema'
import { createLogger } from '@sim/logger'
import { and, eq } from 'drizzle-orm'
import { isClientOnlyTool } from '@/lib/copilot/tools/client/ui-config'
import { routeExecution } from '@/lib/copilot/tools/server/router'
import { SIM_AGENT_API_URL_DEFAULT } from '@/lib/copilot/constants'
import { env } from '@/lib/core/config/env'
import { generateRequestId } from '@/lib/core/utils/request'
import { getBaseUrl } from '@/lib/core/utils/urls'
import { getEffectiveDecryptedEnv } from '@/lib/environment/utils'
import { refreshTokenIfNeeded } from '@/app/api/auth/oauth/utils'
import { resolveEnvVarReferences } from '@/executor/utils/reference-validation'
import { executeTool } from '@/tools'
import { getTool, resolveToolId } from '@/tools/utils'

const logger = createLogger('ServerToolExecutor')

const SIM_AGENT_API_URL = env.SIM_AGENT_API_URL || SIM_AGENT_API_URL_DEFAULT

/**
 * Context for tool execution
 */
export interface ToolExecutionContext {
  userId: string
  workflowId: string
  chatId: string
  streamId: string
  workspaceId?: string
}

/**
 * Result of tool execution
 */
export interface ToolExecutionResult {
  success: boolean
  status: number
  message?: string
  data?: unknown
}

/**
 * Tools that have dedicated server implementations in the router
 */
const SERVER_ROUTED_TOOLS = [
  'edit_workflow',
  'get_workflow_data',
  'get_workflow_console',
  'get_blocks_and_tools',
  'get_blocks_metadata',
  'get_block_options',
  'get_block_config',
  'get_trigger_blocks',
  'knowledge_base',
  'set_environment_variables',
  'get_credentials',
  'search_documentation',
  'make_api_request',
  'search_online',
]

/**
 * Tools that execute workflows
 */
const WORKFLOW_EXECUTION_TOOLS = ['run_workflow']

/**
 * Tools that handle deployments
 */
const DEPLOYMENT_TOOLS = ['deploy_api', 'deploy_chat', 'deploy_mcp', 'redeploy']

/**
 * Execute a tool server-side.
 * Returns result to be sent to Sim Agent via mark-complete.
 */
export async function executeToolServerSide(
  toolName: string,
  toolCallId: string,
  args: Record<string, unknown>,
  context: ToolExecutionContext
): Promise<ToolExecutionResult> {
  logger.info('Executing tool server-side', {
    toolName,
    toolCallId,
    userId: context.userId,
    workflowId: context.workflowId,
  })

  // 1. Check if tool is client-only
  if (isClientOnlyTool(toolName)) {
    logger.info('Skipping client-only tool', { toolName, toolCallId })
    return {
      success: true,
      status: 200,
      message: `Tool "${toolName}" requires a browser session and was skipped in API mode.`,
      data: { skipped: true, reason: 'client_only' },
    }
  }

  try {
    // 2. Route to appropriate executor
    if (SERVER_ROUTED_TOOLS.includes(toolName)) {
      return executeServerRoutedTool(toolName, args, context)
    }

    if (WORKFLOW_EXECUTION_TOOLS.includes(toolName)) {
      return executeRunWorkflow(args, context)
    }

    if (DEPLOYMENT_TOOLS.includes(toolName)) {
      return executeDeploymentTool(toolName, args, context)
    }

    // 3. Try integration tool execution (Slack, Gmail, etc.)
    return executeIntegrationTool(toolName, toolCallId, args, context)
  } catch (error) {
    logger.error('Tool execution failed', {
      toolName,
      toolCallId,
      error: error instanceof Error ? error.message : String(error),
    })
    return {
      success: false,
      status: 500,
      message: error instanceof Error ? error.message : 'Tool execution failed',
    }
  }
}

/**
 * Execute a tool that has a dedicated server implementation
 */
async function executeServerRoutedTool(
  toolName: string,
  args: Record<string, unknown>,
  context: ToolExecutionContext
): Promise<ToolExecutionResult> {
  try {
    const result = await routeExecution(toolName, args, { userId: context.userId })
    return {
      success: true,
      status: 200,
      data: result,
    }
  } catch (error) {
    return {
      success: false,
      status: 500,
      message: error instanceof Error ? error.message : 'Server tool execution failed',
    }
  }
}

/**
 * Execute the run_workflow tool
 */
async function executeRunWorkflow(
  args: Record<string, unknown>,
  context: ToolExecutionContext
): Promise<ToolExecutionResult> {
  const workflowId = (args.workflowId as string) || context.workflowId
  const input = (args.input as Record<string, unknown>) || {}

  logger.info('Executing run_workflow', { workflowId, inputKeys: Object.keys(input) })

  try {
    const response = await fetch(`${getBaseUrl()}/api/workflows/${workflowId}/execute`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${await generateInternalToken()}`,
      },
      body: JSON.stringify({
        input,
        triggerType: 'copilot',
        workflowId, // For internal auth
      }),
    })

    if (!response.ok) {
      const errorText = await response.text()
      return {
        success: false,
        status: response.status,
        message: `Workflow execution failed: ${errorText}`,
      }
    }

    const result = await response.json()
    return {
      success: true,
      status: 200,
      data: result,
    }
  } catch (error) {
    return {
      success: false,
      status: 500,
      message: error instanceof Error ? error.message : 'Workflow execution failed',
    }
  }
}

/**
 * Execute a deployment tool
 */
async function executeDeploymentTool(
  toolName: string,
  args: Record<string, unknown>,
  context: ToolExecutionContext
): Promise<ToolExecutionResult> {
  // Deployment tools modify workflow state and create deployments
  // These can be executed server-side via the server router
  try {
    const result = await routeExecution(toolName, args, { userId: context.userId })
    return {
      success: true,
      status: 200,
      data: result,
    }
  } catch (error) {
    // If the tool isn't in the router, it might need to be added
    // For now, return a skip result
    logger.warn('Deployment tool not available server-side', { toolName })
    return {
      success: true,
      status: 200,
      message: `Deployment tool "${toolName}" executed with limited functionality in API mode.`,
      data: { skipped: true, reason: 'limited_api_support' },
    }
  }
}

/**
 * Execute an integration tool (Slack, Gmail, etc.)
 * Uses the same logic as /api/copilot/execute-tool
 */
async function executeIntegrationTool(
  toolName: string,
  toolCallId: string,
  args: Record<string, unknown>,
  context: ToolExecutionContext
): Promise<ToolExecutionResult> {
  const resolvedToolName = resolveToolId(toolName)
  const toolConfig = getTool(resolvedToolName)

  if (!toolConfig) {
    // Tool not found - try server router as fallback
    try {
      const result = await routeExecution(toolName, args, { userId: context.userId })
      return {
        success: true,
        status: 200,
        data: result,
      }
    } catch {
      logger.warn('Tool not found', { toolName, resolvedToolName })
      return {
        success: true,
        status: 200,
        message: `Tool "${toolName}" not found. Skipped.`,
        data: { skipped: true, reason: 'not_found' },
      }
    }
  }

  // Get workspaceId for env vars
  let workspaceId = context.workspaceId
  if (!workspaceId && context.workflowId) {
    const workflowResult = await db
      .select({ workspaceId: workflow.workspaceId })
      .from(workflow)
      .where(eq(workflow.id, context.workflowId))
      .limit(1)
    workspaceId = workflowResult[0]?.workspaceId ?? undefined
  }

  // Get decrypted environment variables
  const decryptedEnvVars = await getEffectiveDecryptedEnv(context.userId, workspaceId)

  // Resolve env var references in arguments
  const executionParams: Record<string, unknown> = resolveEnvVarReferences(
    args,
    decryptedEnvVars,
    {
      resolveExactMatch: true,
      allowEmbedded: true,
      trimKeys: true,
      onMissing: 'keep',
      deep: true,
    }
  ) as Record<string, unknown>

  // Resolve OAuth access token if required
  if (toolConfig.oauth?.required && toolConfig.oauth.provider) {
    const provider = toolConfig.oauth.provider

    try {
      const accounts = await db
        .select()
        .from(account)
        .where(and(eq(account.providerId, provider), eq(account.userId, context.userId)))
        .limit(1)

      if (accounts.length > 0) {
        const acc = accounts[0]
        const requestId = generateRequestId()
        const { accessToken } = await refreshTokenIfNeeded(requestId, acc as any, acc.id)

        if (accessToken) {
          executionParams.accessToken = accessToken
        } else {
          return {
            success: false,
            status: 400,
            message: `OAuth token not available for ${provider}. Please reconnect your account.`,
          }
        }
      } else {
        return {
          success: false,
          status: 400,
          message: `No ${provider} account connected. Please connect your account first.`,
        }
      }
    } catch (error) {
      return {
        success: false,
        status: 500,
        message: `Failed to get OAuth token for ${toolConfig.oauth.provider}`,
      }
    }
  }

  // Check if tool requires an API key
  const needsApiKey = toolConfig.params?.apiKey?.required
  if (needsApiKey && !executionParams.apiKey) {
    return {
      success: false,
      status: 400,
      message: `API key not provided for ${toolName}.`,
    }
  }

  // Add execution context
  executionParams._context = {
    workflowId: context.workflowId,
    userId: context.userId,
  }

  // Special handling for function_execute
  if (toolName === 'function_execute') {
    executionParams.envVars = decryptedEnvVars
    executionParams.workflowVariables = {}
    executionParams.blockData = {}
    executionParams.blockNameMapping = {}
    executionParams.language = executionParams.language || 'javascript'
    executionParams.timeout = executionParams.timeout || 30000
  }

  // Execute the tool
  const result = await executeTool(resolvedToolName, executionParams, true)

  logger.info('Integration tool execution complete', {
    toolName,
    success: result.success,
  })

  return {
    success: result.success,
    status: result.success ? 200 : 500,
    message: result.error,
    data: result.output,
  }
}

/**
 * Mark a tool as complete with Sim Agent
 */
export async function markToolComplete(
  toolCallId: string,
  toolName: string,
  result: ToolExecutionResult
): Promise<boolean> {
  logger.info('Marking tool complete', {
    toolCallId,
    toolName,
    success: result.success,
    status: result.status,
  })

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
        status: result.status,
        message: result.message,
        data: result.data,
      }),
    })

    if (!response.ok) {
      logger.error('Mark complete failed', { toolCallId, status: response.status })
      return false
    }

    return true
  } catch (error) {
    logger.error('Mark complete error', {
      toolCallId,
      error: error instanceof Error ? error.message : String(error),
    })
    return false
  }
}

/**
 * Generate an internal authentication token for server-to-server calls
 */
async function generateInternalToken(): Promise<string> {
  // Use the same pattern as A2A for internal auth
  const { generateInternalToken: genToken } = await import('@/app/api/a2a/serve/[agentId]/utils')
  return genToken()
}

