import { eq, sql } from 'drizzle-orm'
import { type NextRequest, NextResponse } from 'next/server'
import { v4 as uuidv4 } from 'uuid'
import { isDev } from '@/lib/environment'
import { createLogger } from '@/lib/logs/console-logger'
import { EnhancedLoggingSession } from '@/lib/logs/enhanced-logging-session'
import { buildTraceSpans } from '@/lib/logs/trace-spans'
import { processStreamingBlockLogs } from '@/lib/tokenization'
import { decryptSecret } from '@/lib/utils'
import { db } from '@/db'
import { chat, environment as envTable, userStats, workflow } from '@/db/schema'
import { Executor } from '@/executor'
import type { BlockLog } from '@/executor/types'
import { Serializer } from '@/serializer'
import { mergeSubblockState } from '@/stores/workflows/server-utils'
import type { WorkflowState } from '@/stores/workflows/workflow/types'

declare global {
  var __chatStreamProcessingTasks: Promise<{ success: boolean; error?: any }>[] | undefined
}

const logger = createLogger('ChatAuthUtils')

export const encryptAuthToken = (subdomainId: string, type: string): string => {
  return Buffer.from(`${subdomainId}:${type}:${Date.now()}`).toString('base64')
}

export const validateAuthToken = (token: string, subdomainId: string): boolean => {
  try {
    const decoded = Buffer.from(token, 'base64').toString()
    const [storedId, _type, timestamp] = decoded.split(':')

    // Check if token is for this subdomain
    if (storedId !== subdomainId) {
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
export const setChatAuthCookie = (
  response: NextResponse,
  subdomainId: string,
  type: string
): void => {
  const token = encryptAuthToken(subdomainId, type)
  // Set cookie with HttpOnly and secure flags
  response.cookies.set({
    name: `chat_auth_${subdomainId}`,
    value: token,
    httpOnly: true,
    secure: !isDev,
    sameSite: 'lax',
    path: '/',
    // Using subdomain for the domain in production
    domain: isDev ? undefined : '.simstudio.ai',
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
 * Executes a workflow for a chat request and returns the formatted output.
 *
 * When workflows reference <start.input>, they receive the input directly.
 * The conversationId is available at <start.conversationId> for maintaining chat context.
 *
 * @param chatId - Chat deployment identifier
 * @param input - User's chat input
 * @param conversationId - Optional ID for maintaining conversation context
 * @returns Workflow execution result formatted for the chat interface
 */
export async function executeWorkflowForChat(
  chatId: string,
  input: string,
  conversationId?: string
): Promise<any> {
  const requestId = crypto.randomUUID().slice(0, 8)

  logger.debug(
    `[${requestId}] Executing workflow for chat: ${chatId}${
      conversationId ? `, conversationId: ${conversationId}` : ''
    }`
  )

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

  // Set up enhanced logging for chat execution
  const loggingSession = new EnhancedLoggingSession(workflowId, executionId, 'chat', requestId)

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

  // Find the workflow (deployedState is NOT deprecated - needed for chat execution)
  const workflowResult = await db
    .select({
      isDeployed: workflow.isDeployed,
      deployedState: workflow.deployedState,
      variables: workflow.variables,
    })
    .from(workflow)
    .where(eq(workflow.id, workflowId))
    .limit(1)

  if (workflowResult.length === 0 || !workflowResult[0].isDeployed) {
    logger.warn(`[${requestId}] Workflow not found or not deployed: ${workflowId}`)
    throw new Error('Workflow not available')
  }

  // For chat execution, use ONLY the deployed state (no fallback)
  if (!workflowResult[0].deployedState) {
    throw new Error(`Workflow must be deployed to be available for chat`)
  }

  // Use deployed state for chat execution (this is the stable, deployed version)
  const deployedState = workflowResult[0].deployedState as WorkflowState
  const { blocks, edges, loops, parallels } = deployedState

  // Prepare for execution, similar to use-workflow-execution.ts
  const mergedStates = mergeSubblockState(blocks)
  const currentBlockStates = Object.entries(mergedStates).reduce(
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

  // Get user environment variables for this workflow
  let envVars: Record<string, string> = {}
  try {
    const envResult = await db
      .select()
      .from(envTable)
      .where(eq(envTable.userId, deployment.userId))
      .limit(1)

    if (envResult.length > 0 && envResult[0].variables) {
      envVars = envResult[0].variables as Record<string, string>
    }
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

  // Create serialized workflow
  const serializedWorkflow = new Serializer().serializeWorkflow(
    mergedStates,
    edges,
    loops,
    parallels
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

  // Start enhanced logging session
  await loggingSession.safeStart({
    userId: deployment.userId,
    workspaceId: '', // TODO: Get from workflow
    variables: workflowVariables,
  })

  const stream = new ReadableStream({
    async start(controller) {
      const encoder = new TextEncoder()
      const streamedContent = new Map<string, string>()

      const onStream = async (streamingExecution: any): Promise<void> => {
        if (!streamingExecution.stream) return

        const blockId = streamingExecution.execution?.blockId
        const reader = streamingExecution.stream.getReader()
        if (blockId) {
          streamedContent.set(blockId, '')
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

      const executor = new Executor({
        workflow: serializedWorkflow,
        currentBlockStates: processedBlockStates,
        envVarValues: decryptedEnvVars,
        workflowInput: { input: input, conversationId },
        workflowVariables,
        contextExtensions: {
          stream: true,
          selectedOutputIds: selectedOutputIds.length > 0 ? selectedOutputIds : outputBlockIds,
          edges: edges.map((e: any) => ({
            source: e.source,
            target: e.target,
          })),
          onStream,
        },
      })

      // Set up enhanced logging on the executor
      loggingSession.setupExecutor(executor)

      let result
      try {
        result = await executor.execute(workflowId)
      } catch (error: any) {
        logger.error(`[${requestId}] Chat workflow execution failed:`, error)
        await loggingSession.safeCompleteWithError({
          endedAt: new Date().toISOString(),
          totalDurationMs: 0,
          error: {
            message: error.message || 'Chat workflow execution failed',
            stackTrace: error.stack,
          },
        })
        throw error
      }

      if (result && 'success' in result) {
        // Update streamed content and apply tokenization
        if (result.logs) {
          result.logs.forEach((log: BlockLog) => {
            if (streamedContent.has(log.blockId)) {
              const content = streamedContent.get(log.blockId)
              if (log.output) {
                log.output.content = content
              }
            }
          })

          // Process all logs for streaming tokenization
          const processedCount = processStreamingBlockLogs(result.logs, streamedContent)
          logger.info(`[CHAT-API] Processed ${processedCount} blocks for streaming tokenization`)
        }

        const { traceSpans, totalDuration } = buildTraceSpans(result)
        const enrichedResult = { ...result, traceSpans, totalDuration }
        if (conversationId) {
          if (!enrichedResult.metadata) {
            enrichedResult.metadata = {
              duration: totalDuration,
              startTime: new Date().toISOString(),
            }
          }
          ;(enrichedResult.metadata as any).conversationId = conversationId
        }
        const executionId = uuidv4()
        logger.debug(`Generated execution ID for deployed chat: ${executionId}`)

        if (result.success) {
          try {
            await db
              .update(userStats)
              .set({
                totalChatExecutions: sql`total_chat_executions + 1`,
                lastActive: new Date(),
              })
              .where(eq(userStats.userId, deployment.userId))
            logger.debug(`Updated user stats for deployed chat: ${deployment.userId}`)
          } catch (error) {
            logger.error(`Failed to update user stats for deployed chat:`, error)
          }
        }
      }

      if (!(result && typeof result === 'object' && 'stream' in result)) {
        controller.enqueue(
          encoder.encode(`data: ${JSON.stringify({ event: 'final', data: result })}\n\n`)
        )
      }

      // Complete enhanced logging session (for both success and failure)
      if (result && 'success' in result) {
        const { traceSpans } = buildTraceSpans(result)
        await loggingSession.safeComplete({
          endedAt: new Date().toISOString(),
          totalDurationMs: result.metadata?.duration || 0,
          finalOutput: result.output,
          traceSpans,
        })
      }

      controller.close()
    },
  })

  return stream
}
