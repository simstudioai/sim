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
import {
  createErrorResponse,
  createSuccessResponse,
  processApiWorkflowField,
} from '@/app/api/workflows/utils'
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

  const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i

  return selectedOutputs.map((outputId) => {
    if (UUID_REGEX.test(outputId)) {
      return outputId
    }

    const dotIndex = outputId.indexOf('.')
    if (dotIndex === -1) {
      logger.warn(`Invalid output ID format (missing dot): ${outputId}`)
      return outputId
    }

    const blockName = outputId.substring(0, dotIndex)
    const path = outputId.substring(dotIndex + 1)

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
    skipLoggingComplete?: boolean // When true, skip calling loggingSession.safeComplete (for streaming)
  }
): Promise<ExecutionResult> {
  const workflowId = workflow.id
  const executionId = uuidv4()

  const executionKey = `${workflowId}:${requestId}`

  if (runningExecutions.has(executionKey)) {
    logger.warn(`[${requestId}] Execution is already running: ${executionKey}`)
    throw new Error('Execution is already running')
  }

  const loggingSession = new LoggingSession(workflowId, executionId, 'api', requestId)

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

  logger.info(
    `[${requestId}] Executing workflow with input:`,
    input ? JSON.stringify(input, null, 2) : 'No input provided'
  )

  const processedInput = input
  logger.info(
    `[${requestId}] Using input directly for workflow:`,
    JSON.stringify(processedInput, null, 2)
  )

  try {
    runningExecutions.add(executionKey)
    logger.info(`[${requestId}] Starting workflow execution: ${workflowId}`)

    const deployedData = await loadDeployedWorkflowState(workflowId)
    const { blocks, edges, loops, parallels } = deployedData
    logger.info(`[${requestId}] Using deployed state for workflow execution: ${workflowId}`)
    logger.debug(`[${requestId}] Deployed data loaded:`, {
      blocksCount: Object.keys(blocks || {}).length,
      edgesCount: (edges || []).length,
      loopsCount: Object.keys(loops || {}).length,
      parallelsCount: Object.keys(parallels || {}).length,
    })

    const mergedStates = mergeSubblockState(blocks)

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

    const currentBlockStates = await Object.entries(mergedStates).reduce(
      async (accPromise, [id, block]) => {
        const acc = await accPromise
        acc[id] = await Object.entries(block.subBlocks).reduce(
          async (subAccPromise, [key, subBlock]) => {
            const subAcc = await subAccPromise
            let value = subBlock.value

            if (typeof value === 'string' && value.includes('{{') && value.includes('}}')) {
              const matches = value.match(/{{([^}]+)}}/g)
              if (matches) {
                for (const match of matches) {
                  const varName = match.slice(2, -2)
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

    const processedBlockStates = Object.entries(currentBlockStates).reduce(
      (acc, [blockId, blockState]) => {
        if (blockState.responseFormat && typeof blockState.responseFormat === 'string') {
          const responseFormatValue = blockState.responseFormat.trim()

          if (responseFormatValue.startsWith('<') && responseFormatValue.includes('>')) {
            logger.debug(
              `[${requestId}] Response format contains variable reference for block ${blockId}`
            )
            acc[blockId] = blockState
          } else if (responseFormatValue === '') {
            acc[blockId] = {
              ...blockState,
              responseFormat: undefined,
            }
          } else {
            try {
              logger.debug(`[${requestId}] Parsing responseFormat for block ${blockId}`)
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

    const workflowVariables = (workflow.variables as Record<string, any>) || {}

    if (Object.keys(workflowVariables).length > 0) {
      logger.debug(
        `[${requestId}] Loaded ${Object.keys(workflowVariables).length} workflow variables for: ${workflowId}`
      )
    } else {
      logger.debug(`[${requestId}] No workflow variables found for: ${workflowId}`)
    }

    logger.debug(`[${requestId}] Serializing workflow: ${workflowId}`)
    const serializedWorkflow = new Serializer().serializeWorkflow(
      mergedStates,
      edges,
      loops,
      parallels,
      true
    )

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

    if (triggerBlock.type !== 'starter') {
      const outgoingConnections = serializedWorkflow.connections.filter(
        (conn) => conn.source === startBlockId
      )
      if (outgoingConnections.length === 0) {
        logger.error(`[${requestId}] API trigger has no outgoing connections`)
        throw new Error('API Trigger block must be connected to other blocks to execute')
      }
    }

    const contextExtensions: any = {
      executionId,
      workspaceId: workflow.workspaceId,
      isDeployedContext: true,
    }

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

    loggingSession.setupExecutor(executor)

    const result = (await executor.execute(workflowId, startBlockId)) as ExecutionResult

    logger.info(`[${requestId}] Workflow execution completed: ${workflowId}`, {
      success: result.success,
      executionTime: result.metadata?.duration,
    })

    const { traceSpans, totalDuration } = buildTraceSpans(result)

    if (result.success) {
      await updateWorkflowRunCounts(workflowId)

      await db
        .update(userStats)
        .set({
          totalApiCalls: sql`total_api_calls + 1`,
          lastActive: sql`now()`,
        })
        .where(eq(userStats.userId, actorUserId))
    }

    if (!streamConfig?.skipLoggingComplete) {
      await loggingSession.safeComplete({
        endedAt: new Date().toISOString(),
        totalDurationMs: totalDuration || 0,
        finalOutput: result.output || {},
        traceSpans: traceSpans || [],
        workflowInput: processedInput,
      })
    } else {
      result._streamingMetadata = {
        loggingSession,
        processedInput,
      }
    }

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

    let triggerType: TriggerType = 'manual'
    const session = await getSession()
    if (!session?.user?.id) {
      const apiKeyHeader = request.headers.get('X-API-Key')
      if (apiKeyHeader) {
        triggerType = 'api'
      }
    }

    try {
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

      const hasResponseBlock = workflowHasResponseBlock(result)
      if (hasResponseBlock) {
        return createHttpResponseFromBlock(result)
      }

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

    if (error instanceof RateLimitError) {
      return createErrorResponse(error.message, error.statusCode, 'RATE_LIMIT_EXCEEDED')
    }

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
    const validation = await validateWorkflowAccess(request as NextRequest, id)
    if (validation.error) {
      logger.warn(`[${requestId}] Workflow access validation failed: ${validation.error.message}`)
      return createErrorResponse(validation.error.message, validation.error.status)
    }

    const executionMode = request.headers.get('X-Execution-Mode')
    const isAsync = executionMode === 'async'

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
      input: rawInput,
    } = extractExecutionParams(request as NextRequest, parsedBody)

    let processedInput = rawInput
    logger.info(`[${requestId}] Raw input received:`, JSON.stringify(rawInput, null, 2))

    try {
      const deployedData = await loadDeployedWorkflowState(workflowId)
      const blocks = deployedData.blocks || {}
      logger.info(`[${requestId}] Loaded ${Object.keys(blocks).length} blocks from workflow`)

      const apiTriggerBlock = Object.values(blocks).find(
        (block: any) => block.type === 'api_trigger'
      ) as any
      logger.info(`[${requestId}] API trigger block found:`, !!apiTriggerBlock)

      if (apiTriggerBlock?.subBlocks?.inputFormat?.value) {
        const inputFormat = apiTriggerBlock.subBlocks.inputFormat.value as Array<{
          name: string
          type: 'string' | 'number' | 'boolean' | 'object' | 'array' | 'files'
        }>
        logger.info(
          `[${requestId}] Input format fields:`,
          inputFormat.map((f) => `${f.name}:${f.type}`).join(', ')
        )

        const fileFields = inputFormat.filter((field) => field.type === 'files')
        logger.info(`[${requestId}] Found ${fileFields.length} file-type fields`)

        if (fileFields.length > 0 && typeof rawInput === 'object' && rawInput !== null) {
          const executionContext = {
            workspaceId: validation.workflow.workspaceId,
            workflowId,
          }

          for (const fileField of fileFields) {
            const fieldValue = rawInput[fileField.name]

            if (fieldValue && typeof fieldValue === 'object') {
              const uploadedFiles = await processApiWorkflowField(
                fieldValue,
                executionContext,
                requestId
              )

              if (uploadedFiles.length > 0) {
                processedInput = {
                  ...processedInput,
                  [fileField.name]: uploadedFiles,
                }
                logger.info(
                  `[${requestId}] Successfully processed ${uploadedFiles.length} file(s) for field: ${fileField.name}`
                )
              }
            }
          }
        }
      }
    } catch (error) {
      logger.error(`[${requestId}] Failed to process file uploads:`, error)
      const errorMessage = error instanceof Error ? error.message : 'Failed to process file uploads'
      return createErrorResponse(errorMessage, 400)
    }

    const input = processedInput

    let authenticatedUserId: string
    let triggerType: TriggerType = 'manual'

    if (finalIsSecureMode) {
      authenticatedUserId = validation.workflow.userId
      triggerType = 'manual'
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

    const userSubscription = await getHighestPrioritySubscription(authenticatedUserId)

    if (isAsync) {
      try {
        const rateLimiter = new RateLimiter()
        const rateLimitCheck = await rateLimiter.checkRateLimitWithSubscription(
          authenticatedUserId,
          userSubscription,
          'api',
          true
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
        false
      )

      if (!rateLimitCheck.allowed) {
        throw new RateLimitError(
          `Rate limit exceeded. You have ${rateLimitCheck.remaining} requests remaining. Resets at ${rateLimitCheck.resetAt.toISOString()}`
        )
      }

      if (streamResponse) {
        const deployedData = await loadDeployedWorkflowState(workflowId)
        const resolvedSelectedOutputs = selectedOutputs
          ? resolveOutputIds(selectedOutputs, deployedData.blocks || {})
          : selectedOutputs

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

      const result = await executeWorkflow(
        validation.workflow,
        requestId,
        input,
        authenticatedUserId,
        undefined
      )

      const hasResponseBlock = workflowHasResponseBlock(result)
      if (hasResponseBlock) {
        return createHttpResponseFromBlock(result)
      }

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

    if (error instanceof RateLimitError) {
      return createErrorResponse(error.message, error.statusCode, 'RATE_LIMIT_EXCEEDED')
    }

    if (error instanceof UsageLimitError) {
      return createErrorResponse(error.message, error.statusCode, 'USAGE_LIMIT_EXCEEDED')
    }

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
