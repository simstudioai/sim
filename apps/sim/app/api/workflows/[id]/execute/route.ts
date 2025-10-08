import { db } from '@sim/db'
import { userStats } from '@sim/db/schema'
import { tasks } from '@trigger.dev/sdk'
import { eq, sql } from 'drizzle-orm'
import { type NextRequest, NextResponse } from 'next/server'
import { v4 as uuidv4 } from 'uuid'
import { z } from 'zod'
import { authenticateApiKeyFromHeader, updateApiKeyLastUsed } from '@/lib/api-key/service'
import { getSession } from '@/lib/auth'
import { checkServerSideUsageLimits } from '@/lib/billing'
import { getHighestPrioritySubscription } from '@/lib/billing/core/subscription'
import { env } from '@/lib/env'
import { getPersonalAndWorkspaceEnv } from '@/lib/environment/utils'
import { createLogger } from '@/lib/logs/console/logger'
import { LoggingSession } from '@/lib/logs/execution/logging-session'
import { buildTraceSpans } from '@/lib/logs/execution/trace-spans/trace-spans'
import { decryptSecret, generateRequestId } from '@/lib/utils'
import { loadDeployedWorkflowState } from '@/lib/workflows/db-helpers'
import { TriggerUtils } from '@/lib/workflows/triggers'
import {
  createHttpResponseFromBlock,
  updateWorkflowRunCounts,
  workflowHasResponseBlock,
} from '@/lib/workflows/utils'
import { validateWorkflowAccess } from '@/app/api/workflows/middleware'
import { createErrorResponse, createSuccessResponse } from '@/app/api/workflows/utils'
import { Executor } from '@/executor'
import type { ExecutionResult } from '@/executor/types'
import { Serializer } from '@/serializer'
import { RateLimitError, RateLimiter, type TriggerType } from '@/services/queue'
import { mergeSubblockState } from '@/stores/workflows/server-utils'

const logger = createLogger('WorkflowExecuteAPI')

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

const EnvVarsSchema = z.record(z.string())

const runningExecutions = new Set<string>()

export function createFilteredResult(result: any) {
  return {
    ...result,
    logs: undefined,
    metadata: result.metadata
      ? {
          ...result.metadata,
          workflowConnections: undefined,
        }
      : undefined,
  }
}

class UsageLimitError extends Error {
  statusCode: number
  constructor(message: string, statusCode = 402) {
    super(message)
    this.statusCode = statusCode
  }
}

/**
 * Resolves output IDs to the internal blockId_attribute format
 * Supports both:
 * - User-facing format: blockName.path (e.g., "agent1.content")
 * - Internal format: blockId_attribute (e.g., "uuid_content") - used by chat deployments
 */
function resolveOutputIds(
  selectedOutputs: string[] | undefined,
  blocks: Record<string, any>
): string[] | undefined {
  if (!selectedOutputs || selectedOutputs.length === 0) {
    return selectedOutputs
  }

  // UUID regex to detect if it's already in blockId_attribute format
  const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i

  return selectedOutputs.map((outputId) => {
    // If it starts with a UUID, it's already in blockId_attribute format (from chat deployments)
    if (UUID_REGEX.test(outputId)) {
      return outputId
    }

    // Otherwise, it's in blockName.path format from the user/API
    const dotIndex = outputId.indexOf('.')
    if (dotIndex === -1) {
      logger.warn(`Invalid output ID format (missing dot): ${outputId}`)
      return outputId
    }

    const blockName = outputId.substring(0, dotIndex)
    const path = outputId.substring(dotIndex + 1)

    // Find the block by name (case-insensitive, ignoring spaces)
    const normalizedBlockName = blockName.toLowerCase().replace(/\s+/g, '')
    const block = Object.values(blocks).find((b: any) => {
      const normalized = (b.name || '').toLowerCase().replace(/\s+/g, '')
      return normalized === normalizedBlockName
    })

    if (!block) {
      logger.warn(`Block not found for name: ${blockName} (from output ID: ${outputId})`)
      return outputId
    }

    const resolvedId = `${block.id}_${path}`
    logger.debug(`Resolved output ID: ${outputId} -> ${resolvedId}`)
    return resolvedId
  })
}

export async function executeWorkflow(
  workflow: any,
  requestId: string,
  input: any | undefined,
  actorUserId: string,
  streamConfig?: {
    enabled: boolean
    selectedOutputs?: string[]
    isSecureMode?: boolean // When true, filter out all sensitive data
    workflowTriggerType?: 'api' | 'chat' // Which trigger block type to look for (default: 'api')
    onStream?: (streamingExec: any) => Promise<void> // Callback for streaming agent responses
    onBlockComplete?: (blockId: string, output: any) => Promise<void> // Callback when any block completes
  }
): Promise<any> {
  const workflowId = workflow.id
  const executionId = uuidv4()

  const executionKey = `${workflowId}:${requestId}`

  if (runningExecutions.has(executionKey)) {
    logger.warn(`[${requestId}] Execution is already running: ${executionKey}`)
    throw new Error('Execution is already running')
  }

  const loggingSession = new LoggingSession(workflowId, executionId, 'api', requestId)

  // Rate limiting is now handled before entering the sync queue

  // Check if the actor has exceeded their usage limits
  const usageCheck = await checkServerSideUsageLimits(actorUserId)
  if (usageCheck.isExceeded) {
    logger.warn(`[${requestId}] User ${workflow.userId} has exceeded usage limits`, {
      currentUsage: usageCheck.currentUsage,
      limit: usageCheck.limit,
    })
    throw new UsageLimitError(
      usageCheck.message || 'Usage limit exceeded. Please upgrade your plan to continue.'
    )
  }

  // Log input to help debug
  logger.info(
    `[${requestId}] Executing workflow with input:`,
    input ? JSON.stringify(input, null, 2) : 'No input provided'
  )

  // Use input directly for API workflows
  const processedInput = input
  logger.info(
    `[${requestId}] Using input directly for workflow:`,
    JSON.stringify(processedInput, null, 2)
  )

  try {
    runningExecutions.add(executionKey)
    logger.info(`[${requestId}] Starting workflow execution: ${workflowId}`)

    // Load workflow data from deployed state for API executions
    const deployedData = await loadDeployedWorkflowState(workflowId)

    // Use deployed data as primary source for API executions
    const { blocks, edges, loops, parallels } = deployedData
    logger.info(`[${requestId}] Using deployed state for workflow execution: ${workflowId}`)
    logger.debug(`[${requestId}] Deployed data loaded:`, {
      blocksCount: Object.keys(blocks || {}).length,
      edgesCount: (edges || []).length,
      loopsCount: Object.keys(loops || {}).length,
      parallelsCount: Object.keys(parallels || {}).length,
    })

    // Use the same execution flow as in scheduled executions
    const mergedStates = mergeSubblockState(blocks)

    // Load personal (for the executing user) and workspace env (workspace overrides personal)
    const { personalEncrypted, workspaceEncrypted } = await getPersonalAndWorkspaceEnv(
      actorUserId,
      workflow.workspaceId || undefined
    )
    const variables = EnvVarsSchema.parse({ ...personalEncrypted, ...workspaceEncrypted })

    await loggingSession.safeStart({
      userId: actorUserId,
      workspaceId: workflow.workspaceId,
      variables,
    })

    // Replace environment variables in the block states
    const currentBlockStates = await Object.entries(mergedStates).reduce(
      async (accPromise, [id, block]) => {
        const acc = await accPromise
        acc[id] = await Object.entries(block.subBlocks).reduce(
          async (subAccPromise, [key, subBlock]) => {
            const subAcc = await subAccPromise
            let value = subBlock.value

            // If the value is a string and contains environment variable syntax
            if (typeof value === 'string' && value.includes('{{') && value.includes('}}')) {
              const matches = value.match(/{{([^}]+)}}/g)
              if (matches) {
                // Process all matches sequentially
                for (const match of matches) {
                  const varName = match.slice(2, -2) // Remove {{ and }}
                  const encryptedValue = variables[varName]
                  if (!encryptedValue) {
                    throw new Error(`Environment variable "${varName}" was not found`)
                  }

                  try {
                    const { decrypted } = await decryptSecret(encryptedValue)
                    value = (value as string).replace(match, decrypted)
                  } catch (error: any) {
                    logger.error(
                      `[${requestId}] Error decrypting environment variable "${varName}"`,
                      error
                    )
                    throw new Error(
                      `Failed to decrypt environment variable "${varName}": ${error.message}`
                    )
                  }
                }
              }
            }

            subAcc[key] = value
            return subAcc
          },
          Promise.resolve({} as Record<string, any>)
        )
        return acc
      },
      Promise.resolve({} as Record<string, Record<string, any>>)
    )

    // Create a map of decrypted environment variables
    const decryptedEnvVars: Record<string, string> = {}
    for (const [key, encryptedValue] of Object.entries(variables)) {
      try {
        const { decrypted } = await decryptSecret(encryptedValue)
        decryptedEnvVars[key] = decrypted
      } catch (error: any) {
        logger.error(`[${requestId}] Failed to decrypt environment variable "${key}"`, error)
        throw new Error(`Failed to decrypt environment variable "${key}": ${error.message}`)
      }
    }

    // Process the block states to ensure response formats are properly parsed
    const processedBlockStates = Object.entries(currentBlockStates).reduce(
      (acc, [blockId, blockState]) => {
        // Check if this block has a responseFormat that needs to be parsed
        if (blockState.responseFormat && typeof blockState.responseFormat === 'string') {
          const responseFormatValue = blockState.responseFormat.trim()

          // Check for variable references like <start.input>
          if (responseFormatValue.startsWith('<') && responseFormatValue.includes('>')) {
            logger.debug(
              `[${requestId}] Response format contains variable reference for block ${blockId}`
            )
            // Keep variable references as-is - they will be resolved during execution
            acc[blockId] = blockState
          } else if (responseFormatValue === '') {
            // Empty string - remove response format
            acc[blockId] = {
              ...blockState,
              responseFormat: undefined,
            }
          } else {
            try {
              logger.debug(`[${requestId}] Parsing responseFormat for block ${blockId}`)
              // Attempt to parse the responseFormat if it's a string
              const parsedResponseFormat = JSON.parse(responseFormatValue)

              acc[blockId] = {
                ...blockState,
                responseFormat: parsedResponseFormat,
              }
            } catch (error) {
              logger.warn(
                `[${requestId}] Failed to parse responseFormat for block ${blockId}, using undefined`,
                error
              )
              // Set to undefined instead of keeping malformed JSON - this allows execution to continue
              acc[blockId] = {
                ...blockState,
                responseFormat: undefined,
              }
            }
          }
        } else {
          acc[blockId] = blockState
        }
        return acc
      },
      {} as Record<string, Record<string, any>>
    )

    // Get workflow variables - they are stored as JSON objects in the database
    const workflowVariables = (workflow.variables as Record<string, any>) || {}

    if (Object.keys(workflowVariables).length > 0) {
      logger.debug(
        `[${requestId}] Loaded ${Object.keys(workflowVariables).length} workflow variables for: ${workflowId}`
      )
    } else {
      logger.debug(`[${requestId}] No workflow variables found for: ${workflowId}`)
    }

    // Serialize and execute the workflow
    logger.debug(`[${requestId}] Serializing workflow: ${workflowId}`)
    const serializedWorkflow = new Serializer().serializeWorkflow(
      mergedStates,
      edges,
      loops,
      parallels,
      true // Enable validation during execution
    )

    // Determine trigger start block based on execution type
    // - 'chat': For chat deployments (looks for chat_trigger block)
    // - 'api': For direct API execution (looks for api_trigger block)
    // streamConfig is passed from POST handler when using streaming/chat
    const preferredTriggerType = streamConfig?.workflowTriggerType || 'api'
    const startBlock = TriggerUtils.findStartBlock(mergedStates, preferredTriggerType, false)

    if (!startBlock) {
      const errorMsg =
        preferredTriggerType === 'api'
          ? 'No API trigger block found. Add an API Trigger block to this workflow.'
          : 'No chat trigger block found. Add a Chat Trigger block to this workflow.'
      logger.error(`[${requestId}] ${errorMsg}`)
      throw new Error(errorMsg)
    }

    const startBlockId = startBlock.blockId
    const triggerBlock = startBlock.block

    // Check if the API trigger has any outgoing connections (except for legacy starter blocks)
    // Legacy starter blocks have their own validation in the executor
    if (triggerBlock.type !== 'starter') {
      const outgoingConnections = serializedWorkflow.connections.filter(
        (conn) => conn.source === startBlockId
      )
      if (outgoingConnections.length === 0) {
        logger.error(`[${requestId}] API trigger has no outgoing connections`)
        throw new Error('API Trigger block must be connected to other blocks to execute')
      }
    }

    // Build context extensions
    const contextExtensions: any = {
      executionId,
      workspaceId: workflow.workspaceId,
      isDeployedContext: true,
    }

    // Add streaming configuration if enabled
    if (streamConfig?.enabled) {
      contextExtensions.stream = true
      contextExtensions.selectedOutputs = streamConfig.selectedOutputs || []
      contextExtensions.edges = edges.map((e: any) => ({
        source: e.source,
        target: e.target,
      }))
      contextExtensions.onStream = streamConfig.onStream
      contextExtensions.onBlockComplete = streamConfig.onBlockComplete
    }

    const executor = new Executor({
      workflow: serializedWorkflow,
      currentBlockStates: processedBlockStates,
      envVarValues: decryptedEnvVars,
      workflowInput: processedInput,
      workflowVariables,
      contextExtensions,
    })

    // Set up logging on the executor
    loggingSession.setupExecutor(executor)

    // Execute workflow (will always return ExecutionResult since we don't use onStream)
    const result = (await executor.execute(workflowId, startBlockId)) as ExecutionResult

    logger.info(`[${requestId}] Workflow execution completed: ${workflowId}`, {
      success: result.success,
      executionTime: result.metadata?.duration,
    })

    // Build trace spans from execution result (works for both success and failure)
    const { traceSpans, totalDuration } = buildTraceSpans(result)

    // Update workflow run counts if execution was successful
    if (result.success) {
      await updateWorkflowRunCounts(workflowId)

      // Track API call in user stats
      await db
        .update(userStats)
        .set({
          totalApiCalls: sql`total_api_calls + 1`,
          lastActive: sql`now()`,
        })
        .where(eq(userStats.userId, actorUserId))
    }

    await loggingSession.safeComplete({
      endedAt: new Date().toISOString(),
      totalDurationMs: totalDuration || 0,
      finalOutput: result.output || {},
      traceSpans: (traceSpans || []) as any,
    })

    // For non-streaming, return the execution result
    return result
  } catch (error: any) {
    logger.error(`[${requestId}] Workflow execution failed: ${workflowId}`, error)

    const executionResultForError = (error?.executionResult as ExecutionResult | undefined) || {
      success: false,
      output: {},
      logs: [],
    }
    const { traceSpans } = buildTraceSpans(executionResultForError)

    await loggingSession.safeCompleteWithError({
      endedAt: new Date().toISOString(),
      totalDurationMs: 0,
      error: {
        message: error.message || 'Workflow execution failed',
        stackTrace: error.stack,
      },
      traceSpans,
    })

    throw error
  } finally {
    runningExecutions.delete(executionKey)
  }
}

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const requestId = generateRequestId()
  const { id } = await params

  try {
    logger.debug(`[${requestId}] GET execution request for workflow: ${id}`)
    const validation = await validateWorkflowAccess(request, id)
    if (validation.error) {
      logger.warn(`[${requestId}] Workflow access validation failed: ${validation.error.message}`)
      return createErrorResponse(validation.error.message, validation.error.status)
    }

    // Determine trigger type based on authentication
    let triggerType: TriggerType = 'manual'
    const session = await getSession()
    if (!session?.user?.id) {
      // Check for API key
      const apiKeyHeader = request.headers.get('X-API-Key')
      if (apiKeyHeader) {
        triggerType = 'api'
      }
    }

    // Note: Async execution is now handled in the POST handler below

    // Synchronous execution
    try {
      // Resolve actor user id
      let actorUserId: string | null = null
      if (triggerType === 'manual') {
        actorUserId = session!.user!.id
      } else {
        const apiKeyHeader = request.headers.get('X-API-Key')
        const auth = apiKeyHeader ? await authenticateApiKeyFromHeader(apiKeyHeader) : null
        if (!auth?.success || !auth.userId) {
          return createErrorResponse('Unauthorized', 401)
        }
        actorUserId = auth.userId
        if (auth.keyId) {
          void updateApiKeyLastUsed(auth.keyId).catch(() => {})
        }

        // Check rate limits BEFORE entering execution for API requests
        const userSubscription = await getHighestPrioritySubscription(actorUserId)
        const rateLimiter = new RateLimiter()
        const rateLimitCheck = await rateLimiter.checkRateLimitWithSubscription(
          actorUserId,
          userSubscription,
          'api',
          false
        )
        if (!rateLimitCheck.allowed) {
          throw new RateLimitError(
            `Rate limit exceeded. You have ${rateLimitCheck.remaining} requests remaining. Resets at ${rateLimitCheck.resetAt.toISOString()}`
          )
        }
      }

      const result = await executeWorkflow(
        validation.workflow,
        requestId,
        undefined,
        actorUserId as string
      )

      // Check if the workflow execution contains a response block output
      const hasResponseBlock = workflowHasResponseBlock(result)
      if (hasResponseBlock) {
        return createHttpResponseFromBlock(result)
      }

      // Filter out logs and workflowConnections from the API response
      const filteredResult = createFilteredResult(result)
      return createSuccessResponse(filteredResult)
    } catch (error: any) {
      if (error.message?.includes('Service overloaded')) {
        return createErrorResponse(
          'Service temporarily overloaded. Please try again later.',
          503,
          'SERVICE_OVERLOADED'
        )
      }
      throw error
    }
  } catch (error: any) {
    logger.error(`[${requestId}] Error executing workflow: ${id}`, error)

    // Check if this is a rate limit error
    if (error instanceof RateLimitError) {
      return createErrorResponse(error.message, error.statusCode, 'RATE_LIMIT_EXCEEDED')
    }

    // Check if this is a usage limit error
    if (error instanceof UsageLimitError) {
      return createErrorResponse(error.message, error.statusCode, 'USAGE_LIMIT_EXCEEDED')
    }

    return createErrorResponse(
      error.message || 'Failed to execute workflow',
      500,
      'EXECUTION_ERROR'
    )
  }
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
): Promise<Response> {
  const requestId = generateRequestId()
  const logger = createLogger('WorkflowExecuteAPI')
  logger.info(`[${requestId}] Raw request body: `)

  const { id } = await params
  const workflowId = id

  try {
    // Validate workflow access
    const validation = await validateWorkflowAccess(request as NextRequest, id)
    if (validation.error) {
      logger.warn(`[${requestId}] Workflow access validation failed: ${validation.error.message}`)
      return createErrorResponse(validation.error.message, validation.error.status)
    }

    // Check execution mode from header
    const executionMode = request.headers.get('X-Execution-Mode')
    const isAsync = executionMode === 'async'

    // Parse request body first to check for internal parameters
    const body = await request.text()
    logger.info(`[${requestId}] ${body ? 'Request body provided' : 'No request body provided'}`)

    let parsedBody: any = {}
    if (body) {
      try {
        parsedBody = JSON.parse(body)
      } catch (error) {
        logger.error(`[${requestId}] Failed to parse request body as JSON`, error)
        return createErrorResponse('Invalid JSON in request body', 400)
      }
    }

    logger.info(`[${requestId}] Input passed to workflow:`, parsedBody)

    const extractExecutionParams = (req: NextRequest, body: any) => {
      const internalSecret = req.headers.get('X-Internal-Secret')
      const isInternalCall = internalSecret === env.INTERNAL_API_SECRET

      return {
        isSecureMode: body.isSecureMode !== undefined ? body.isSecureMode : isInternalCall,
        streamResponse: req.headers.get('X-Stream-Response') === 'true' || body.stream === true,
        selectedOutputs:
          body.selectedOutputs ||
          (req.headers.get('X-Selected-Outputs')
            ? JSON.parse(req.headers.get('X-Selected-Outputs')!)
            : undefined),
        workflowTriggerType:
          body.workflowTriggerType || (isInternalCall && body.stream ? 'chat' : 'api'),
        input: body.input !== undefined ? body.input : body,
      }
    }

    const {
      isSecureMode: finalIsSecureMode,
      streamResponse,
      selectedOutputs,
      workflowTriggerType,
      input,
    } = extractExecutionParams(request as NextRequest, parsedBody)

    // Get authenticated user and determine trigger type
    let authenticatedUserId: string
    let triggerType: TriggerType = 'manual'

    // For internal calls (chat deployments), use the workflow owner's ID
    if (finalIsSecureMode) {
      authenticatedUserId = validation.workflow.userId
      triggerType = 'manual' // Chat deployments use manual trigger type (no rate limit)
    } else {
      const session = await getSession()
      const apiKeyHeader = request.headers.get('X-API-Key')

      if (session?.user?.id && !apiKeyHeader) {
        authenticatedUserId = session.user.id
        triggerType = 'manual'
      } else if (apiKeyHeader) {
        const auth = await authenticateApiKeyFromHeader(apiKeyHeader)
        if (!auth.success || !auth.userId) {
          return createErrorResponse('Unauthorized', 401)
        }
        authenticatedUserId = auth.userId
        triggerType = 'api'
        if (auth.keyId) {
          void updateApiKeyLastUsed(auth.keyId).catch(() => {})
        }
      } else {
        return createErrorResponse('Authentication required', 401)
      }
    }

    // Get user subscription (checks both personal and org subscriptions)
    const userSubscription = await getHighestPrioritySubscription(authenticatedUserId)

    if (isAsync) {
      try {
        const rateLimiter = new RateLimiter()
        const rateLimitCheck = await rateLimiter.checkRateLimitWithSubscription(
          authenticatedUserId,
          userSubscription,
          'api',
          true // isAsync = true
        )

        if (!rateLimitCheck.allowed) {
          logger.warn(`[${requestId}] Rate limit exceeded for async execution`, {
            userId: authenticatedUserId,
            remaining: rateLimitCheck.remaining,
            resetAt: rateLimitCheck.resetAt,
          })

          return new Response(
            JSON.stringify({
              error: 'Rate limit exceeded',
              message: `You have exceeded your async execution limit. ${rateLimitCheck.remaining} requests remaining. Limit resets at ${rateLimitCheck.resetAt}.`,
              remaining: rateLimitCheck.remaining,
              resetAt: rateLimitCheck.resetAt,
            }),
            {
              status: 429,
              headers: { 'Content-Type': 'application/json' },
            }
          )
        }

        // Rate limit passed - always use Trigger.dev for async executions
        const handle = await tasks.trigger('workflow-execution', {
          workflowId,
          userId: authenticatedUserId,
          input,
          triggerType: 'api',
          metadata: { triggerType: 'api' },
        })

        logger.info(
          `[${requestId}] Created Trigger.dev task ${handle.id} for workflow ${workflowId}`
        )

        return new Response(
          JSON.stringify({
            success: true,
            taskId: handle.id,
            status: 'queued',
            createdAt: new Date().toISOString(),
            links: {
              status: `/api/jobs/${handle.id}`,
            },
          }),
          {
            status: 202,
            headers: { 'Content-Type': 'application/json' },
          }
        )
      } catch (error: any) {
        logger.error(`[${requestId}] Failed to create Trigger.dev task:`, error)
        return createErrorResponse('Failed to queue workflow execution', 500)
      }
    }

    try {
      const rateLimiter = new RateLimiter()
      const rateLimitCheck = await rateLimiter.checkRateLimitWithSubscription(
        authenticatedUserId,
        userSubscription,
        triggerType,
        false // isAsync = false for sync calls
      )

      if (!rateLimitCheck.allowed) {
        throw new RateLimitError(
          `Rate limit exceeded. You have ${rateLimitCheck.remaining} requests remaining. Resets at ${rateLimitCheck.resetAt.toISOString()}`
        )
      }

      // Handle streaming response - wrap execution in SSE stream
      if (streamResponse) {
        // Load workflow blocks to resolve output IDs from blockName.attribute to blockId_attribute format
        const deployedData = await loadDeployedWorkflowState(workflowId)
        const resolvedSelectedOutputs = selectedOutputs
          ? resolveOutputIds(selectedOutputs, deployedData.blocks || {})
          : selectedOutputs

        // Use shared streaming response creator
        const { createStreamingResponse } = await import('@/lib/workflows/streaming')
        const { SSE_HEADERS } = await import('@/lib/utils')

        const stream = await createStreamingResponse({
          requestId,
          workflow: validation.workflow,
          input,
          executingUserId: authenticatedUserId,
          streamConfig: {
            selectedOutputs: resolvedSelectedOutputs,
            isSecureMode: finalIsSecureMode,
            workflowTriggerType,
          },
          createFilteredResult,
        })

        return new NextResponse(stream, {
          status: 200,
          headers: SSE_HEADERS,
        })
      }

      // Non-streaming execution
      const result = await executeWorkflow(
        validation.workflow,
        requestId,
        input,
        authenticatedUserId,
        undefined
      )

      // Non-streaming response
      const hasResponseBlock = workflowHasResponseBlock(result)
      if (hasResponseBlock) {
        return createHttpResponseFromBlock(result)
      }

      // Filter out logs and workflowConnections from the API response
      const filteredResult = createFilteredResult(result)
      return createSuccessResponse(filteredResult)
    } catch (error: any) {
      if (error.message?.includes('Service overloaded')) {
        return createErrorResponse(
          'Service temporarily overloaded. Please try again later.',
          503,
          'SERVICE_OVERLOADED'
        )
      }
      throw error
    }
  } catch (error: any) {
    logger.error(`[${requestId}] Error executing workflow: ${workflowId}`, error)

    // Check if this is a rate limit error
    if (error instanceof RateLimitError) {
      return createErrorResponse(error.message, error.statusCode, 'RATE_LIMIT_EXCEEDED')
    }

    // Check if this is a usage limit error
    if (error instanceof UsageLimitError) {
      return createErrorResponse(error.message, error.statusCode, 'USAGE_LIMIT_EXCEEDED')
    }

    // Check if this is a rate limit error (string match for backward compatibility)
    if (error.message?.includes('Rate limit exceeded')) {
      return createErrorResponse(error.message, 429, 'RATE_LIMIT_EXCEEDED')
    }

    return createErrorResponse(
      error.message || 'Failed to execute workflow',
      500,
      'EXECUTION_ERROR'
    )
  }
}

export async function OPTIONS(_request: NextRequest) {
  return new NextResponse(null, {
    status: 200,
    headers: {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers':
        'Content-Type, X-API-Key, X-CSRF-Token, X-Requested-With, Accept, Accept-Version, Content-Length, Content-MD5, Date, X-Api-Version',
      'Access-Control-Max-Age': '86400',
    },
  })
}
