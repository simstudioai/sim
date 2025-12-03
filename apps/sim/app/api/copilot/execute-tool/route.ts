import { db } from '@sim/db'
import { account } from '@sim/db/schema'
import { eq } from 'drizzle-orm'
import { type NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { refreshTokenIfNeeded } from '@/app/api/auth/oauth/utils'
import { getSession } from '@/lib/auth'
import {
  createBadRequestResponse,
  createInternalServerErrorResponse,
  createRequestTracker,
  createUnauthorizedResponse,
} from '@/lib/copilot/request-helpers'
import { generateRequestId } from '@/lib/core/utils/request'
import { getEffectiveDecryptedEnv } from '@/lib/environment/utils'
import { createLogger } from '@/lib/logs/console/logger'
import { executeTool } from '@/tools'
import { getTool } from '@/tools/utils'

const logger = createLogger('CopilotExecuteToolAPI')

const ExecuteToolSchema = z.object({
  toolCallId: z.string(),
  toolName: z.string(),
  arguments: z.record(z.any()).optional().default({}),
  workflowId: z.string().optional(),
})

/**
 * Maps environment variable names to tool API key parameters
 * Convention: {PROVIDER}_API_KEY -> apiKey for tools starting with {provider}_
 */
function mapEnvVarsToToolParams(
  toolId: string,
  toolConfig: any,
  envVars: Record<string, string>
): Record<string, string> {
  const params: Record<string, string> = {}

  // Check if tool has an apiKey parameter that needs to be filled
  const hasApiKeyParam =
    toolConfig.params?.apiKey &&
    toolConfig.params.apiKey.visibility === 'user-only' &&
    toolConfig.params.apiKey.required

  if (!hasApiKeyParam) return params

  // Extract provider prefix from tool ID (e.g., 'exa' from 'exa_search')
  const toolPrefix = toolId.split('_')[0]?.toUpperCase()

  // Common API key environment variable patterns to check
  const envKeyPatterns = [`${toolPrefix}_API_KEY`, `${toolPrefix}AI_API_KEY`, `${toolPrefix}_KEY`]

  // Special mappings for tools with non-standard naming
  const specialMappings: Record<string, string[]> = {
    FIRECRAWL: ['FIRECRAWL_API_KEY', 'FIRECRAWL_KEY'],
    TAVILY: ['TAVILY_API_KEY', 'TAVILY_KEY'],
    EXA: ['EXA_API_KEY', 'EXAAI_API_KEY', 'EXA_KEY'],
    LINKUP: ['LINKUP_API_KEY', 'LINKUP_KEY'],
    GOOGLE: ['GOOGLE_API_KEY', 'GOOGLE_SEARCH_API_KEY'],
    SERPER: ['SERPER_API_KEY', 'SERPER_KEY'],
    SERPAPI: ['SERPAPI_API_KEY', 'SERPAPI_KEY'],
    BING: ['BING_API_KEY', 'BING_SEARCH_API_KEY'],
    BRAVE: ['BRAVE_API_KEY', 'BRAVE_SEARCH_API_KEY'],
    PERPLEXITY: ['PERPLEXITY_API_KEY', 'PPLX_API_KEY'],
    JINA: ['JINA_API_KEY', 'JINA_KEY'],
  }

  // Combine standard patterns with special mappings
  const keysToCheck = [...envKeyPatterns]
  if (specialMappings[toolPrefix]) {
    keysToCheck.push(...specialMappings[toolPrefix])
  }

  // Find the first matching environment variable
  for (const envKey of keysToCheck) {
    if (envVars[envKey]) {
      params.apiKey = envVars[envKey]
      logger.info('Mapped environment variable to tool apiKey', {
        toolId,
        envKey,
        hasValue: true,
      })
      break
    }
  }

  return params
}

/**
 * POST /api/copilot/execute-tool
 * Execute an integration tool with resolved credentials
 * Called by the sim-agent service when it needs to execute a tool
 */
export async function POST(req: NextRequest) {
  const tracker = createRequestTracker()

  try {
    const session = await getSession()
    if (!session?.user?.id) {
      return createUnauthorizedResponse()
    }

    const userId = session.user.id
    const body = await req.json()

    try {
      const preview = JSON.stringify(body).slice(0, 300)
      logger.debug(`[${tracker.requestId}] Incoming execute-tool request`, { preview })
    } catch {}

    const { toolCallId, toolName, arguments: toolArgs, workflowId } = ExecuteToolSchema.parse(body)

    logger.info(`[${tracker.requestId}] Executing tool`, {
      toolCallId,
      toolName,
      workflowId,
      hasArgs: Object.keys(toolArgs).length > 0,
    })

    // Get tool config from registry
    const toolConfig = getTool(toolName)
    if (!toolConfig) {
      // Find similar tool names to help debug
      const { tools: allTools } = await import('@/tools/registry')
      const allToolNames = Object.keys(allTools)
      const prefix = toolName.split('_').slice(0, 2).join('_')
      const similarTools = allToolNames
        .filter((name) => name.startsWith(prefix.split('_')[0] + '_'))
        .slice(0, 10)

      logger.warn(`[${tracker.requestId}] Tool not found in registry`, {
        toolName,
        prefix,
        similarTools,
        totalToolsInRegistry: allToolNames.length,
      })
      return NextResponse.json(
        {
          success: false,
          error: `Tool not found: ${toolName}. Similar tools: ${similarTools.join(', ')}`,
          toolCallId,
        },
        { status: 404 }
      )
    }

    // Build execution params starting with LLM-provided arguments
    const executionParams: Record<string, any> = { ...toolArgs }

    // Resolve OAuth access token if required
    if (toolConfig.oauth?.required && toolConfig.oauth.provider) {
      const provider = toolConfig.oauth.provider
      logger.info(`[${tracker.requestId}] Resolving OAuth token`, { provider })

      try {
        // Find the account for this provider
        const accounts = await db
          .select()
          .from(account)
          .where(eq(account.providerId, provider))
          .limit(1)

        if (accounts.length > 0) {
          const acc = accounts[0]
          const requestId = generateRequestId()
          const { accessToken } = await refreshTokenIfNeeded(requestId, acc as any, acc.id)

          if (accessToken) {
            executionParams.accessToken = accessToken
            logger.info(`[${tracker.requestId}] OAuth token resolved`, { provider })
          } else {
            logger.warn(`[${tracker.requestId}] No access token available`, { provider })
            return NextResponse.json(
              {
                success: false,
                error: `OAuth token not available for ${provider}. Please reconnect your account.`,
                toolCallId,
              },
              { status: 400 }
            )
          }
        } else {
          logger.warn(`[${tracker.requestId}] No account found for provider`, { provider })
          return NextResponse.json(
            {
              success: false,
              error: `No ${provider} account connected. Please connect your account first.`,
              toolCallId,
            },
            { status: 400 }
          )
        }
      } catch (error) {
        logger.error(`[${tracker.requestId}] Failed to resolve OAuth token`, {
          provider,
          error: error instanceof Error ? error.message : String(error),
        })
        return NextResponse.json(
          {
            success: false,
            error: `Failed to get OAuth token for ${provider}`,
            toolCallId,
          },
          { status: 500 }
        )
      }
    }

    // Resolve API key - either from LLM-provided name or from env vars
    const needsApiKey = toolConfig.params?.apiKey?.required
    const llmProvidedApiKey = executionParams.apiKey as string | undefined

    if (needsApiKey || llmProvidedApiKey) {
      logger.info(`[${tracker.requestId}] Resolving API key for tool`, {
        toolName,
        needsApiKey,
        hasLlmProvidedKey: !!llmProvidedApiKey,
        llmProvidedKeyPreview: llmProvidedApiKey
          ? `${llmProvidedApiKey.substring(0, 20)}...`
          : null,
      })

      try {
        const decryptedEnvVars = await getEffectiveDecryptedEnv(userId, workflowId)

        // Case 1: LLM provided an API key name (e.g., "EXA_API_KEY") - resolve it
        if (llmProvidedApiKey) {
          // Check if it looks like an env var name (uppercase with underscores, ends with _KEY or _API_KEY)
          const looksLikeEnvVar = /^[A-Z][A-Z0-9_]*(_KEY|_API_KEY)$/.test(llmProvidedApiKey)

          if (looksLikeEnvVar && decryptedEnvVars[llmProvidedApiKey]) {
            // Resolve the env var name to its actual value
            executionParams.apiKey = decryptedEnvVars[llmProvidedApiKey]
            logger.info(`[${tracker.requestId}] Resolved API key from LLM-provided name`, {
              toolName,
              envVarName: llmProvidedApiKey,
            })
          } else if (looksLikeEnvVar) {
            // LLM provided an env var name but it's not configured
            logger.warn(`[${tracker.requestId}] LLM provided API key name not found in env vars`, {
              toolName,
              envVarName: llmProvidedApiKey,
              availableKeys: Object.keys(decryptedEnvVars),
            })
            return NextResponse.json(
              {
                success: false,
                error: `API key "${llmProvidedApiKey}" is not configured. Please add it in settings.`,
                toolCallId,
              },
              { status: 400 }
            )
          }
          // else: LLM provided what looks like an actual API key value, keep it as-is
        }

        // Case 2: No API key yet but tool requires one - resolve from tool prefix convention
        if (!executionParams.apiKey && needsApiKey) {
          const apiKeyParams = mapEnvVarsToToolParams(toolName, toolConfig, decryptedEnvVars)

          if (apiKeyParams.apiKey) {
            executionParams.apiKey = apiKeyParams.apiKey
            logger.info(`[${tracker.requestId}] API key resolved from tool prefix`, { toolName })
          } else {
            logger.warn(`[${tracker.requestId}] No API key found for tool`, { toolName })
            return NextResponse.json(
              {
                success: false,
                error: `API key not configured for ${toolName}. Please add the required API key in settings.`,
                toolCallId,
              },
              { status: 400 }
            )
          }
        }
      } catch (error) {
        logger.error(`[${tracker.requestId}] Failed to resolve API key`, {
          toolName,
          error: error instanceof Error ? error.message : String(error),
        })
        return NextResponse.json(
          {
            success: false,
            error: `Failed to get API key for ${toolName}`,
            toolCallId,
          },
          { status: 500 }
        )
      }
    }

    // Add execution context
    executionParams._context = {
      workflowId,
      userId,
    }

    // Special handling for function_execute - inject environment variables
    if (toolName === 'function_execute') {
      try {
        const decryptedEnvVars = await getEffectiveDecryptedEnv(userId, workflowId)
        executionParams.envVars = decryptedEnvVars
        executionParams.workflowVariables = {} // No workflow variables in copilot context
        executionParams.blockData = {} // No block data in copilot context
        executionParams.blockNameMapping = {} // No block mapping in copilot context
        executionParams.language = executionParams.language || 'javascript'
        executionParams.timeout = executionParams.timeout || 30000

        logger.info(`[${tracker.requestId}] Injected env vars for function_execute`, {
          envVarCount: Object.keys(decryptedEnvVars).length,
        })
      } catch (error) {
        logger.warn(`[${tracker.requestId}] Failed to get env vars for function_execute`, {
          error: error instanceof Error ? error.message : String(error),
        })
        // Continue without env vars - code can still execute
        executionParams.envVars = {}
      }
    }

    // Execute the tool
    logger.info(`[${tracker.requestId}] Executing tool with resolved credentials`, {
      toolName,
      hasAccessToken: !!executionParams.accessToken,
      hasApiKey: !!executionParams.apiKey,
    })

    const result = await executeTool(toolName, executionParams, true)

    logger.info(`[${tracker.requestId}] Tool execution complete`, {
      toolName,
      success: result.success,
      hasOutput: !!result.output,
    })

    return NextResponse.json({
      success: true,
      toolCallId,
      result: {
        success: result.success,
        output: result.output,
        error: result.error,
      },
    })
  } catch (error) {
    if (error instanceof z.ZodError) {
      logger.debug(`[${tracker.requestId}] Zod validation error`, { issues: error.issues })
      return createBadRequestResponse('Invalid request body for execute-tool')
    }
    logger.error(`[${tracker.requestId}] Failed to execute tool:`, error)
    const errorMessage = error instanceof Error ? error.message : 'Failed to execute tool'
    return createInternalServerErrorResponse(errorMessage)
  }
}

