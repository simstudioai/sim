import { db } from '@sim/db'
import { chat, workflow } from '@sim/db/schema'
import { eq } from 'drizzle-orm'
import { type NextRequest, NextResponse } from 'next/server'
import { isDev } from '@/lib/environment'
import { createLogger } from '@/lib/logs/console/logger'
import { hasAdminPermission } from '@/lib/permissions/utils'
import { processStreamingBlockLogs } from '@/lib/tokenization'
import { decryptSecret, generateRequestId } from '@/lib/utils'
import { TriggerUtils } from '@/lib/workflows/triggers'
import { CHAT_ERROR_MESSAGES } from '@/app/chat/constants'
import { getBlock } from '@/blocks'
import { Executor } from '@/executor'
import type { BlockLog, ExecutionResult, StreamingExecution } from '@/executor/types'
import { Serializer } from '@/serializer'
import { mergeSubblockState } from '@/stores/workflows/server-utils'
import type { WorkflowState } from '@/stores/workflows/workflow/types'

declare global {
  var __chatStreamProcessingTasks: Promise<{ success: boolean; error?: any }>[] | undefined
}

const logger = createLogger('ChatAuthUtils')

/**
 * Check if user has permission to create a chat for a specific workflow
 * Either the user owns the workflow directly OR has admin permission for the workflow's workspace
 */
export async function checkWorkflowAccessForChatCreation(
  workflowId: string,
  userId: string
): Promise<{ hasAccess: boolean; workflow?: any }> {
  // Get workflow data
  const workflowData = await db.select().from(workflow).where(eq(workflow.id, workflowId)).limit(1)

  if (workflowData.length === 0) {
    return { hasAccess: false }
  }

  const workflowRecord = workflowData[0]

  // Case 1: User owns the workflow directly
  if (workflowRecord.userId === userId) {
    return { hasAccess: true, workflow: workflowRecord }
  }

  // Case 2: Workflow belongs to a workspace and user has admin permission
  if (workflowRecord.workspaceId) {
    const hasAdmin = await hasAdminPermission(userId, workflowRecord.workspaceId)
    if (hasAdmin) {
      return { hasAccess: true, workflow: workflowRecord }
    }
  }

  return { hasAccess: false }
}

/**
 * Check if user has access to view/edit/delete a specific chat
 * Either the user owns the chat directly OR has admin permission for the workflow's workspace
 */
export async function checkChatAccess(
  chatId: string,
  userId: string
): Promise<{ hasAccess: boolean; chat?: any }> {
  // Get chat with workflow information
  const chatData = await db
    .select({
      chat: chat,
      workflowWorkspaceId: workflow.workspaceId,
    })
    .from(chat)
    .innerJoin(workflow, eq(chat.workflowId, workflow.id))
    .where(eq(chat.id, chatId))
    .limit(1)

  if (chatData.length === 0) {
    return { hasAccess: false }
  }

  const { chat: chatRecord, workflowWorkspaceId } = chatData[0]

  // Case 1: User owns the chat directly
  if (chatRecord.userId === userId) {
    return { hasAccess: true, chat: chatRecord }
  }

  // Case 2: Chat's workflow belongs to a workspace and user has admin permission
  if (workflowWorkspaceId) {
    const hasAdmin = await hasAdminPermission(userId, workflowWorkspaceId)
    if (hasAdmin) {
      return { hasAccess: true, chat: chatRecord }
    }
  }

  return { hasAccess: false }
}

export const encryptAuthToken = (chatId: string, type: string): string => {
  return Buffer.from(`${chatId}:${type}:${Date.now()}`).toString('base64')
}

export const validateAuthToken = (token: string, chatId: string): boolean => {
  try {
    const decoded = Buffer.from(token, 'base64').toString()
    const [storedId, _type, timestamp] = decoded.split(':')

    // Check if token is for this chat
    if (storedId !== chatId) {
      return false
    }

    // Check if token is not expired (24 hours)
    const createdAt = Number.parseInt(timestamp)
    const now = Date.now()
    const expireTime = 24 * 60 * 60 * 1000 // 24 hours

    if (now - createdAt > expireTime) {
      return false
    }

    return true
  } catch (_e) {
    return false
  }
}

// Set cookie helper function
export const setChatAuthCookie = (response: NextResponse, chatId: string, type: string): void => {
  const token = encryptAuthToken(chatId, type)
  // Set cookie with HttpOnly and secure flags
  response.cookies.set({
    name: `chat_auth_${chatId}`,
    value: token,
    httpOnly: true,
    secure: !isDev,
    sameSite: 'lax',
    path: '/',
    maxAge: 60 * 60 * 24, // 24 hours
  })
}

// Helper function to add CORS headers to responses
export function addCorsHeaders(response: NextResponse, request: NextRequest) {
  // Get the origin from the request
  const origin = request.headers.get('origin') || ''

  // In development, allow any localhost subdomain
  if (isDev && origin.includes('localhost')) {
    response.headers.set('Access-Control-Allow-Origin', origin)
    response.headers.set('Access-Control-Allow-Credentials', 'true')
    response.headers.set('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
    response.headers.set('Access-Control-Allow-Headers', 'Content-Type, X-Requested-With')
  }

  return response
}

// Handle OPTIONS requests for CORS preflight
export async function OPTIONS(request: NextRequest) {
  const response = new NextResponse(null, { status: 204 })
  return addCorsHeaders(response, request)
}

// Validate authentication for chat access
export async function validateChatAuth(
  requestId: string,
  deployment: any,
  request: NextRequest,
  parsedBody?: any
): Promise<{ authorized: boolean; error?: string }> {
  const authType = deployment.authType || 'public'

  // Public chats are accessible to everyone
  if (authType === 'public') {
    return { authorized: true }
  }

  // Check for auth cookie first
  const cookieName = `chat_auth_${deployment.id}`
  const authCookie = request.cookies.get(cookieName)

  if (authCookie && validateAuthToken(authCookie.value, deployment.id)) {
    return { authorized: true }
  }

  // For password protection, check the password in the request body
  if (authType === 'password') {
    // For GET requests, we just notify the client that authentication is required
    if (request.method === 'GET') {
      return { authorized: false, error: 'auth_required_password' }
    }

    try {
      // Use the parsed body if provided, otherwise the auth check is not applicable
      if (!parsedBody) {
        return { authorized: false, error: 'Password is required' }
      }

      const { password, input } = parsedBody

      // If this is a chat message, not an auth attempt
      if (input && !password) {
        return { authorized: false, error: 'auth_required_password' }
      }

      if (!password) {
        return { authorized: false, error: 'Password is required' }
      }

      if (!deployment.password) {
        logger.error(`[${requestId}] No password set for password-protected chat: ${deployment.id}`)
        return { authorized: false, error: 'Authentication configuration error' }
      }

      // Decrypt the stored password and compare
      const { decrypted } = await decryptSecret(deployment.password)
      if (password !== decrypted) {
        return { authorized: false, error: 'Invalid password' }
      }

      return { authorized: true }
    } catch (error) {
      logger.error(`[${requestId}] Error validating password:`, error)
      return { authorized: false, error: 'Authentication error' }
    }
  }

  // For email access control, check the email in the request body
  if (authType === 'email') {
    // For GET requests, we just notify the client that authentication is required
    if (request.method === 'GET') {
      return { authorized: false, error: 'auth_required_email' }
    }

    try {
      // Use the parsed body if provided, otherwise the auth check is not applicable
      if (!parsedBody) {
        return { authorized: false, error: 'Email is required' }
      }

      const { email, input } = parsedBody

      // If this is a chat message, not an auth attempt
      if (input && !email) {
        return { authorized: false, error: 'auth_required_email' }
      }

      if (!email) {
        return { authorized: false, error: 'Email is required' }
      }

      const allowedEmails = deployment.allowedEmails || []

      // Check exact email matches
      if (allowedEmails.includes(email)) {
        // Email is allowed but still needs OTP verification
        // Return a special error code that the client will recognize
        return { authorized: false, error: 'otp_required' }
      }

      // Check domain matches (prefixed with @)
      const domain = email.split('@')[1]
      if (domain && allowedEmails.some((allowed: string) => allowed === `@${domain}`)) {
        // Domain is allowed but still needs OTP verification
        return { authorized: false, error: 'otp_required' }
      }

      return { authorized: false, error: 'Email not authorized' }
    } catch (error) {
      logger.error(`[${requestId}] Error validating email:`, error)
      return { authorized: false, error: 'Authentication error' }
    }
  }

  // Unknown auth type
  return { authorized: false, error: 'Unsupported authentication type' }
}

/**
 * @deprecated This function has been replaced by the unified workflow execution API.
 * Chat deployments now use /api/workflows/[id]/execute with internal authentication.
 * This function is kept for reference but should not be used.
 */
export async function executeWorkflowForChat(
  chatId: string,
  input: string,
  conversationId?: string
): Promise<any> {
  throw new Error(
    'executeWorkflowForChat is deprecated. Use the unified /api/workflows/[id]/execute API instead.'
  )
<<<<<<< HEAD

  // Find the chat deployment
  const deploymentResult = await db
    .select({
      id: chat.id,
      workflowId: chat.workflowId,
      userId: chat.userId,
      outputConfigs: chat.outputConfigs,
      customizations: chat.customizations,
    })
    .from(chat)
    .where(eq(chat.id, chatId))
    .limit(1)

  if (deploymentResult.length === 0) {
    logger.warn(`[${requestId}] Chat not found: ${chatId}`)
    throw new Error('Chat not found')
  }

  const deployment = deploymentResult[0]
  const workflowId = deployment.workflowId
  const executionId = uuidv4()

  const usageCheck = await checkServerSideUsageLimits(deployment.userId)
  if (usageCheck.isExceeded) {
    logger.warn(
      `[${requestId}] User ${deployment.userId} has exceeded usage limits. Skipping chat execution.`,
      {
        currentUsage: usageCheck.currentUsage,
        limit: usageCheck.limit,
        workflowId: deployment.workflowId,
        chatId,
      }
    )
    throw new Error(usageCheck.message || CHAT_ERROR_MESSAGES.USAGE_LIMIT_EXCEEDED)
  }

  // Set up logging for chat execution
  const loggingSession = new LoggingSession(workflowId, executionId, 'chat', requestId)

  // Check for multi-output configuration in customizations
  const customizations = (deployment.customizations || {}) as Record<string, any>
  let outputBlockIds: string[] = []

  // Extract output configs from the new schema format
  let selectedOutputIds: string[] = []
  if (deployment.outputConfigs && Array.isArray(deployment.outputConfigs)) {
    // Extract output IDs in the format expected by the streaming processor
    logger.debug(
      `[${requestId}] Found ${deployment.outputConfigs.length} output configs in deployment`
    )

    selectedOutputIds = deployment.outputConfigs.map((config) => {
      const outputId = config.path
        ? `${config.blockId}_${config.path}`
        : `${config.blockId}.content`

      logger.debug(
        `[${requestId}] Processing output config: blockId=${config.blockId}, path=${config.path || 'content'} -> outputId=${outputId}`
      )

      return outputId
    })

    // Also extract block IDs for legacy compatibility
    outputBlockIds = deployment.outputConfigs.map((config) => config.blockId)
  } else {
    // Use customizations as fallback
    outputBlockIds = Array.isArray(customizations.outputBlockIds)
      ? customizations.outputBlockIds
      : []
  }

  // Fall back to customizations if we still have no outputs
  if (
    outputBlockIds.length === 0 &&
    customizations.outputBlockIds &&
    customizations.outputBlockIds.length > 0
  ) {
    outputBlockIds = customizations.outputBlockIds
  }

  logger.debug(
    `[${requestId}] Using ${outputBlockIds.length} output blocks and ${selectedOutputIds.length} selected output IDs for extraction`
  )

  // Find the workflow to check if it's deployed
  const workflowResult = await db
    .select({
      isDeployed: workflow.isDeployed,
      variables: workflow.variables,
      workspaceId: workflow.workspaceId,
    })
    .from(workflow)
    .where(eq(workflow.id, workflowId))
    .limit(1)

  if (workflowResult.length === 0 || !workflowResult[0].isDeployed) {
    logger.warn(`[${requestId}] Workflow not found or not deployed: ${workflowId}`)
    throw new Error('Workflow not available')
  }

  // Load the active deployed state from the deployment versions table
  const { loadDeployedWorkflowState } = await import('@/lib/workflows/db-helpers')

  let deployedState: WorkflowState
  try {
    deployedState = await loadDeployedWorkflowState(workflowId)
  } catch (error) {
    logger.error(`[${requestId}] Failed to load deployed state for workflow ${workflowId}:`, error)
    throw new Error(`Workflow must be deployed to be available for chat`)
  }

  const { blocks, edges, loops, parallels } = deployedState

  // Prepare for execution, similar to use-workflow-execution.ts
  const mergedStates = mergeSubblockState(blocks)

  const filteredStates = Object.entries(mergedStates).reduce(
    (acc, [id, block]) => {
      const blockConfig = getBlock(block.type)
      const isTriggerBlock = blockConfig?.category === 'triggers'
      const isChatTrigger = block.type === 'chat_trigger'

      // Keep all non-trigger blocks and also keep the chat_trigger block
      if (!isTriggerBlock || isChatTrigger) {
        acc[id] = block
      }
      return acc
    },
    {} as typeof mergedStates
  )

  const currentBlockStates = Object.entries(filteredStates).reduce(
    (acc, [id, block]) => {
      acc[id] = Object.entries(block.subBlocks).reduce(
        (subAcc, [key, subBlock]) => {
          subAcc[key] = subBlock.value
          return subAcc
        },
        {} as Record<string, any>
      )
      return acc
    },
    {} as Record<string, Record<string, any>>
  )

  // Get user environment variables with workspace precedence
  let envVars: Record<string, string> = {}
  try {
    const workspaceId = workflowResult[0].workspaceId || undefined
    const { personalEncrypted, workspaceEncrypted } = await getPersonalAndWorkspaceEnv(
      deployment.userId,
      workspaceId
    )
    envVars = { ...personalEncrypted, ...workspaceEncrypted }
  } catch (error) {
    logger.warn(`[${requestId}] Could not fetch environment variables:`, error)
  }

  let workflowVariables = {}
  try {
    if (workflowResult[0].variables) {
      workflowVariables =
        typeof workflowResult[0].variables === 'string'
          ? JSON.parse(workflowResult[0].variables)
          : workflowResult[0].variables
    }
  } catch (error) {
    logger.warn(`[${requestId}] Could not parse workflow variables:`, error)
  }

  // Filter edges to exclude connections to/from trigger blocks (same as manual execution)
  const triggerBlockIds = Object.keys(mergedStates).filter((id) => {
    const type = mergedStates[id].type
    const blockConfig = getBlock(type)
    // Exclude chat_trigger from the list so its edges are preserved
    return blockConfig?.category === 'triggers' && type !== 'chat_trigger'
  })

  const filteredEdges = edges.filter(
    (edge) => !triggerBlockIds.includes(edge.source) && !triggerBlockIds.includes(edge.target)
  )

  // Create serialized workflow with filtered blocks and edges
  const serializedWorkflow = new Serializer().serializeWorkflow(
    filteredStates,
    filteredEdges,
    loops,
    parallels,
    true // Enable validation during execution
  )

  // Decrypt environment variables
  const decryptedEnvVars: Record<string, string> = {}
  for (const [key, encryptedValue] of Object.entries(envVars)) {
    try {
      const { decrypted } = await decryptSecret(encryptedValue)
      decryptedEnvVars[key] = decrypted
    } catch (error: any) {
      logger.error(`[${requestId}] Failed to decrypt environment variable "${key}"`, error)
      // Log but continue - we don't want to break execution if just one var fails
    }
  }

  // Process block states to ensure response formats are properly parsed
  const processedBlockStates = Object.entries(currentBlockStates).reduce(
    (acc, [blockId, blockState]) => {
      // Check if this block has a responseFormat that needs to be parsed
      if (blockState.responseFormat && typeof blockState.responseFormat === 'string') {
        try {
          logger.debug(`[${requestId}] Parsing responseFormat for block ${blockId}`)
          // Attempt to parse the responseFormat if it's a string
          const parsedResponseFormat = JSON.parse(blockState.responseFormat)

          acc[blockId] = {
            ...blockState,
            responseFormat: parsedResponseFormat,
          }
        } catch (error) {
          logger.warn(`[${requestId}] Failed to parse responseFormat for block ${blockId}`, error)
          acc[blockId] = blockState
        }
      } else {
        acc[blockId] = blockState
      }
      return acc
    },
    {} as Record<string, Record<string, any>>
  )

  // Start logging session
  await loggingSession.safeStart({
    userId: deployment.userId,
    workspaceId: workflowResult[0].workspaceId || '',
    variables: workflowVariables,
  })

  let sessionCompleted = false

  const stream = new ReadableStream({
    async start(controller) {
      const encoder = new TextEncoder()
      let executionResultForLogging: ExecutionResult | null = null

      try {
        const streamedContent = new Map<string, string>()
        const streamedBlocks = new Set<string>() // Track which blocks have started streaming

        const onStream = async (streamingExecution: any): Promise<void> => {
          if (!streamingExecution.stream) return

          const blockId = streamingExecution.execution?.blockId
          const reader = streamingExecution.stream.getReader()
          if (blockId) {
            streamedContent.set(blockId, '')

            // Add separator if this is not the first block to stream
            if (streamedBlocks.size > 0) {
              // Send separator before the new block starts
              controller.enqueue(
                encoder.encode(`data: ${JSON.stringify({ blockId, chunk: '\n\n' })}\n\n`)
              )
            }
            streamedBlocks.add(blockId)
          }
          try {
            while (true) {
              const { done, value } = await reader.read()
              if (done) {
                controller.enqueue(
                  encoder.encode(`data: ${JSON.stringify({ blockId, event: 'end' })}\n\n`)
                )
                break
              }
              const chunk = new TextDecoder().decode(value)
              if (blockId) {
                streamedContent.set(blockId, (streamedContent.get(blockId) || '') + chunk)
              }
              controller.enqueue(encoder.encode(`data: ${JSON.stringify({ blockId, chunk })}\n\n`))
            }
          } catch (error) {
            logger.error('Error while reading from stream:', error)
            controller.error(error)
          }
        }

        // Determine the start block for chat execution BEFORE creating executor
        const startBlock = TriggerUtils.findStartBlock(mergedStates, 'chat')

        if (!startBlock) {
          const errorMessage = CHAT_ERROR_MESSAGES.NO_CHAT_TRIGGER
          logger.error(`[${requestId}] ${errorMessage}`)

          if (!sessionCompleted) {
            await loggingSession.safeCompleteWithError({
              endedAt: new Date().toISOString(),
              totalDurationMs: 0,
              error: { message: errorMessage },
              traceSpans: [],
            })
            sessionCompleted = true
          }

          // Send error event that the client expects
          controller.enqueue(
            encoder.encode(
              `data: ${JSON.stringify({
                event: 'error',
                error: CHAT_ERROR_MESSAGES.GENERIC_ERROR,
              })}\n\n`
            )
          )
          controller.close()
          return
        }

        const startBlockId = startBlock.blockId

        // Create executor AFTER confirming we have a chat trigger
        const executor = new Executor({
          workflow: serializedWorkflow,
          currentBlockStates: processedBlockStates,
          envVarValues: decryptedEnvVars,
          workflowInput: { input: input, conversationId },
          workflowVariables,
          contextExtensions: {
            stream: true,
            selectedOutputIds: selectedOutputIds.length > 0 ? selectedOutputIds : outputBlockIds,
            edges: filteredEdges.map((e: any) => ({
              source: e.source,
              target: e.target,
            })),
            onStream,
            isDeployedContext: true,
          },
        })

        // Set up logging on the executor
        loggingSession.setupExecutor(executor)

        let result: ExecutionResult | StreamingExecution | undefined
        try {
          result = await executor.execute(workflowId, startBlockId)
        } catch (error: any) {
          logger.error(`[${requestId}] Chat workflow execution failed:`, error)
          if (!sessionCompleted) {
            const executionResult = error?.executionResult || {
              success: false,
              output: {},
              logs: [],
            }
            const { traceSpans } = buildTraceSpans(executionResult)

            await loggingSession.safeCompleteWithError({
              endedAt: new Date().toISOString(),
              totalDurationMs: 0,
              error: { message: error.message || 'Chat workflow execution failed' },
              traceSpans,
            })
            sessionCompleted = true
          }

          // Send error to stream before ending
          controller.enqueue(
            encoder.encode(
              `data: ${JSON.stringify({
                event: 'error',
                error: error.message || 'Chat workflow execution failed',
              })}\n\n`
            )
          )
          controller.close()
          return // Don't throw - just return to end the stream gracefully
        }

        // Handle both ExecutionResult and StreamingExecution types
        const executionResult =
          result && typeof result === 'object' && 'execution' in result
            ? (result.execution as ExecutionResult)
            : (result as ExecutionResult)

        executionResultForLogging = executionResult

        if (executionResult?.logs) {
          const processedOutputs = new Set<string>()
          executionResult.logs.forEach((log: BlockLog) => {
            if (streamedContent.has(log.blockId)) {
              const content = streamedContent.get(log.blockId)
              if (log.output && content) {
                const separator = processedOutputs.size > 0 ? '\n\n' : ''
                log.output.content = separator + content
                processedOutputs.add(log.blockId)
              }
            }
          })

          const nonStreamingLogs = executionResult.logs.filter(
            (log: BlockLog) => !streamedContent.has(log.blockId)
          )

          const extractBlockIdFromOutputId = (outputId: string): string => {
            return outputId.includes('_') ? outputId.split('_')[0] : outputId.split('.')[0]
          }

          const extractPathFromOutputId = (outputId: string, blockId: string): string => {
            return outputId.substring(blockId.length + 1)
          }

          const parseOutputContentSafely = (output: any): any => {
            if (!output?.content) {
              return output
            }

            if (typeof output.content === 'string') {
              try {
                return JSON.parse(output.content)
              } catch (e) {
                return output
              }
            }

            return output
          }

          const outputsToRender = selectedOutputIds.filter((outputId) => {
            const blockIdForOutput = extractBlockIdFromOutputId(outputId)
            return nonStreamingLogs.some((log) => log.blockId === blockIdForOutput)
          })

          for (const outputId of outputsToRender) {
            const blockIdForOutput = extractBlockIdFromOutputId(outputId)
            const path = extractPathFromOutputId(outputId, blockIdForOutput)
            const log = nonStreamingLogs.find((l) => l.blockId === blockIdForOutput)

            if (log) {
              let outputValue: any = log.output

              if (path) {
                outputValue = parseOutputContentSafely(outputValue)

                const pathParts = path.split('.')
                for (const part of pathParts) {
                  if (outputValue && typeof outputValue === 'object' && part in outputValue) {
                    outputValue = outputValue[part]
                  } else {
                    outputValue = undefined
                    break
                  }
                }
              }

              if (outputValue !== undefined) {
                const separator = processedOutputs.size > 0 ? '\n\n' : ''

                const formattedOutput =
                  typeof outputValue === 'string'
                    ? outputValue
                    : JSON.stringify(outputValue, null, 2)

                if (!log.output.content) {
                  log.output.content = separator + formattedOutput
                } else {
                  log.output.content = separator + formattedOutput
                }
                processedOutputs.add(log.blockId)
              }
            }
          }

          const processedCount = processStreamingBlockLogs(executionResult.logs, streamedContent)
          logger.info(`Processed ${processedCount} blocks for streaming tokenization`)

          const { traceSpans, totalDuration } = buildTraceSpans(executionResult)
          const enrichedResult = { ...executionResult, traceSpans, totalDuration }
          if (conversationId) {
            if (!enrichedResult.metadata) {
              enrichedResult.metadata = {
                duration: totalDuration,
                startTime: new Date().toISOString(),
              }
            }
            ;(enrichedResult.metadata as any).conversationId = conversationId
          }
        }

        if (!(result && typeof result === 'object' && 'stream' in result)) {
          controller.enqueue(
            encoder.encode(`data: ${JSON.stringify({ event: 'final', data: result })}\n\n`)
          )
        }

        if (!sessionCompleted) {
          const resultForTracing =
            executionResult || ({ success: true, output: {}, logs: [] } as ExecutionResult)
          const { traceSpans } = buildTraceSpans(resultForTracing)
          await loggingSession.safeComplete({
            endedAt: new Date().toISOString(),
            totalDurationMs: executionResult?.metadata?.duration || 0,
            finalOutput: executionResult?.output || {},
            traceSpans,
          })
          sessionCompleted = true
        }

        controller.close()
      } catch (error: any) {
        logger.error(`[${requestId}] Chat execution streaming error:`, error)

        if (!sessionCompleted && loggingSession) {
          const executionResult = executionResultForLogging ||
            (error?.executionResult as ExecutionResult | undefined) || {
              success: false,
              output: {},
              logs: [],
            }
          const { traceSpans } = buildTraceSpans(executionResult)

          await loggingSession.safeCompleteWithError({
            endedAt: new Date().toISOString(),
            totalDurationMs: 0,
            error: { message: error.message || 'Stream processing error' },
            traceSpans,
          })
          sessionCompleted = true
        }

        controller.enqueue(
          encoder.encode(
            `data: ${JSON.stringify({
              event: 'error',
              error: error.message || 'Stream processing error',
            })}\n\n`
          )
        )

        controller.close()
      }
    },
  })

  return stream
=======
>>>>>>> 25e250b4 (feat(chat-stream): updated workflow id execute route to support streaming via API)
}
