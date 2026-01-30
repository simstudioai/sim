import { db } from '@sim/db'
import { account, workflow } from '@sim/db/schema'
import { createLogger } from '@sim/logger'
import { and, eq } from 'drizzle-orm'
import { refreshTokenIfNeeded } from '@/app/api/auth/oauth/utils'
import { resolveEnvVarReferences } from '@/executor/utils/reference-validation'
import { SIM_AGENT_API_URL_DEFAULT } from '@/lib/copilot/constants'
import { generateRequestId } from '@/lib/core/utils/request'
import { env } from '@/lib/core/config/env'
import { getEffectiveDecryptedEnv } from '@/lib/environment/utils'
import { executeTool } from '@/tools'
import { getTool, resolveToolId } from '@/tools/utils'
import { routeExecution } from '@/lib/copilot/tools/server/router'
import type { ExecutionContext, ToolCallResult, ToolCallState } from '@/lib/copilot/orchestrator/types'

const logger = createLogger('CopilotToolExecutor')
const SIM_AGENT_API_URL = env.SIM_AGENT_API_URL || SIM_AGENT_API_URL_DEFAULT

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
    const result = await routeExecution(toolName, params, { userId: context.userId })
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

/**
 * Execute an integration tool directly via the tools registry.
 */
async function executeIntegrationToolDirect(
  toolCall: ToolCallState,
  toolConfig: any,
  context: ExecutionContext
): Promise<ToolCallResult> {
  const { userId, workflowId } = context
  const toolName = resolveToolId(toolCall.name)
  const toolArgs = toolCall.params || {}

  let workspaceId = context.workspaceId
  if (!workspaceId && workflowId) {
    const workflowResult = await db
      .select({ workspaceId: workflow.workspaceId })
      .from(workflow)
      .where(eq(workflow.id, workflowId))
      .limit(1)
    workspaceId = workflowResult[0]?.workspaceId ?? undefined
  }

  const decryptedEnvVars =
    context.decryptedEnvVars || (await getEffectiveDecryptedEnv(userId, workspaceId))

  const executionParams: Record<string, any> = resolveEnvVarReferences(
    toolArgs,
    decryptedEnvVars,
    { deep: true }
  ) as Record<string, any>

  if (toolConfig.oauth?.required && toolConfig.oauth.provider) {
    const provider = toolConfig.oauth.provider
    const accounts = await db
      .select()
      .from(account)
      .where(and(eq(account.providerId, provider), eq(account.userId, userId)))
      .limit(1)

    if (!accounts.length) {
      return {
        success: false,
        error: `No ${provider} account connected. Please connect your account first.`,
      }
    }

    const acc = accounts[0]
    const requestId = generateRequestId()
    const { accessToken } = await refreshTokenIfNeeded(requestId, acc as any, acc.id)

    if (!accessToken) {
      return {
        success: false,
        error: `OAuth token not available for ${provider}. Please reconnect your account.`,
      }
    }

    executionParams.accessToken = accessToken
  }

  if (toolConfig.params?.apiKey?.required && !executionParams.apiKey) {
    return {
      success: false,
      error: `API key not provided for ${toolName}. Use {{YOUR_API_KEY_ENV_VAR}} to reference your environment variable.`,
    }
  }

  executionParams._context = {
    workflowId,
    userId,
  }

  if (toolName === 'function_execute') {
    executionParams.envVars = decryptedEnvVars
    executionParams.workflowVariables = {}
    executionParams.blockData = {}
    executionParams.blockNameMapping = {}
    executionParams.language = executionParams.language || 'javascript'
    executionParams.timeout = executionParams.timeout || 30000
  }

  const result = await executeTool(toolName, executionParams)

  return {
    success: result.success,
    output: result.output,
    error: result.error,
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
  let workspaceId: string | undefined
  const workflowResult = await db
    .select({ workspaceId: workflow.workspaceId })
    .from(workflow)
    .where(eq(workflow.id, workflowId))
    .limit(1)
  workspaceId = workflowResult[0]?.workspaceId ?? undefined

  const decryptedEnvVars = await getEffectiveDecryptedEnv(userId, workspaceId)

  return {
    userId,
    workflowId,
    workspaceId,
    decryptedEnvVars,
  }
}

