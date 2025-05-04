import { NextRequest, NextResponse } from 'next/server'
import { createLogger } from '@/lib/logs/console-logger'
import { decryptSecret } from '@/lib/utils'
import { eq } from 'drizzle-orm'
import { v4 as uuidv4 } from 'uuid'
import { db } from '@/db'
import { chat, workflow, environment as envTable } from '@/db/schema'
import { WorkflowState } from '@/stores/workflows/workflow/types'
import { Executor } from '@/executor'
import { Serializer } from '@/serializer'
import { mergeSubblockState } from '@/stores/workflows/utils'
import { persistExecutionLogs } from '@/lib/logs/execution-logger'
import { buildTraceSpans } from '@/lib/logs/trace-spans'
import { BlockLog } from '@/executor/types'

declare global {
  var __chatStreamProcessingTasks: Promise<{success: boolean, error?: any}>[] | undefined
}

const logger = createLogger('ChatAuthUtils')
const isDevelopment = process.env.NODE_ENV === 'development'

// Simple encryption for the auth token
export const encryptAuthToken = (subdomainId: string, type: string): string => {
    return Buffer.from(`${subdomainId}:${type}:${Date.now()}`).toString('base64')
  }
  
  // Decrypt and validate the auth token
  export const validateAuthToken = (token: string, subdomainId: string): boolean => {
    try {
      const decoded = Buffer.from(token, 'base64').toString()
      const [storedId, type, timestamp] = decoded.split(':')
      
      // Check if token is for this subdomain
      if (storedId !== subdomainId) {
        return false
      }
      
      // Check if token is not expired (24 hours)
      const createdAt = parseInt(timestamp)
      const now = Date.now()
      const expireTime = 24 * 60 * 60 * 1000 // 24 hours
      
      if (now - createdAt > expireTime) {
        return false
      }
      
      return true
    } catch (e) {
      return false
    }
  }
  
  // Set cookie helper function
  export const setChatAuthCookie = (response: NextResponse, subdomainId: string, type: string): void => {
    const token = encryptAuthToken(subdomainId, type)
    // Set cookie with HttpOnly and secure flags
    response.cookies.set({
      name: `chat_auth_${subdomainId}`,
      value: token,
      httpOnly: true,
      secure: !isDevelopment,
      sameSite: 'lax',
      path: '/',
      // Using subdomain for the domain in production
      domain: isDevelopment ? undefined : '.simstudio.ai',
      maxAge: 60 * 60 * 24, // 24 hours
    })
  }
  
  // Helper function to add CORS headers to responses
  export function addCorsHeaders(response: NextResponse, request: NextRequest) {
    // Get the origin from the request
    const origin = request.headers.get('origin') || ''
    
    // In development, allow any localhost subdomain
    if (isDevelopment && origin.includes('localhost')) {
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
  ): Promise<{ authorized: boolean, error?: string }> {
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
        
        const { password, message } = parsedBody
        
        // If this is a chat message, not an auth attempt
        if (message && !password) {
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
        
        const { email, message } = parsedBody
        
        // If this is a chat message, not an auth attempt
        if (message && !email) {
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
 * Extract a specific output from a block using the blockId and path
 * This mimics how the chat panel extracts outputs from blocks
 */
function extractBlockOutput(logs: any[], blockId: string, path?: string) {
  // Find the block in logs
  const blockLog = logs.find(log => log.blockId === blockId)
  if (!blockLog || !blockLog.output) return null

  // If no specific path, return the full output
  if (!path) return blockLog.output

  // Navigate the path to extract the specific output
  let result = blockLog.output
  const pathParts = path.split('.')
  
  for (const part of pathParts) {
    if (result === null || result === undefined || typeof result !== 'object') {
      return null
    }
    result = result[part]
  }
  
  return result
}

/**
 * Executes a workflow for a chat and extracts the specified output.
 * This function contains the same logic as the internal chat panel.
 */
export async function executeWorkflowForChat(chatId: string, message: string) {
  const requestId = crypto.randomUUID().slice(0, 8)

  logger.debug(`[${requestId}] Executing workflow for chat: ${chatId}`)
  
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
  
  // Check for multi-output configuration in customizations
  const customizations = (deployment.customizations || {}) as Record<string, any>
  let outputBlockIds: string[] = []
  let outputPaths: string[] = []
  
  // Extract output configs from the new schema format
  if (deployment.outputConfigs && Array.isArray(deployment.outputConfigs)) {
    // Extract block IDs and paths from the new outputConfigs array format
    logger.debug(`[${requestId}] Found ${deployment.outputConfigs.length} output configs in deployment`)
    deployment.outputConfigs.forEach(config => {
      logger.debug(`[${requestId}] Processing output config: blockId=${config.blockId}, path=${config.path || 'none'}`)
    })
    
    outputBlockIds = deployment.outputConfigs.map(config => config.blockId)
    outputPaths = deployment.outputConfigs.map(config => config.path || '')
  } else {
    // Use customizations as fallback
    outputBlockIds = Array.isArray(customizations.outputBlockIds) ? customizations.outputBlockIds : []
    outputPaths = Array.isArray(customizations.outputPaths) ? customizations.outputPaths : []
  }
  
  // Fall back to customizations if we still have no outputs
  if (outputBlockIds.length === 0 && customizations.outputBlockIds && customizations.outputBlockIds.length > 0) {
    outputBlockIds = customizations.outputBlockIds
    outputPaths = customizations.outputPaths || new Array(outputBlockIds.length).fill('')
  }
  
  logger.debug(`[${requestId}] Using ${outputBlockIds.length} output blocks for extraction`)
  
  // Find the workflow
  const workflowResult = await db
    .select({
      state: workflow.state,
      deployedState: workflow.deployedState,
      isDeployed: workflow.isDeployed,
    })
    .from(workflow)
    .where(eq(workflow.id, workflowId))
    .limit(1)
  
  if (workflowResult.length === 0 || !workflowResult[0].isDeployed) {
    logger.warn(`[${requestId}] Workflow not found or not deployed: ${workflowId}`)
    throw new Error('Workflow not available')
  }
  
  // Use deployed state for execution
  const state = (workflowResult[0].deployedState || workflowResult[0].state) as WorkflowState
  const { blocks, edges, loops } = state
  
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
  
  // Get workflow variables
  let workflowVariables = {}
  try {
    // The workflow state may contain variables
    const workflowState = state as any
    if (workflowState.variables) {
      workflowVariables = typeof workflowState.variables === 'string' 
        ? JSON.parse(workflowState.variables) 
        : workflowState.variables
    }
  } catch (error) {
    logger.warn(`[${requestId}] Could not parse workflow variables:`, error)
  }
  
  // Create serialized workflow
  const serializedWorkflow = new Serializer().serializeWorkflow(mergedStates, edges, loops)
  
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
  
  // Create and execute the workflow - mimicking use-workflow-execution.ts
  const executor = new Executor({
    workflow: serializedWorkflow,
    currentBlockStates: processedBlockStates,
    envVarValues: decryptedEnvVars,
    workflowInput: { input: message },
    workflowVariables,
    contextExtensions: {
      // Always request streaming – the executor will downgrade gracefully if unsupported
      stream: true,
      selectedOutputIds: outputBlockIds,
      edges: edges.map((e: any) => ({ source: e.source, target: e.target })),
    },
  })

  // Execute and capture the result
  const result = await executor.execute(workflowId)

  // If the executor returned a ReadableStream, forward it directly for streaming
  if (result instanceof ReadableStream) {
    return result
  }
  
  // Handle StreamingExecution format (combined stream + execution data)
  if (result && typeof result === 'object' && 'stream' in result && 'execution' in result) {
    // We need to stream the response to the client while *also* capturing the full
    // content so that we can persist accurate logs once streaming completes.

    // Duplicate the original stream – one copy goes to the client, the other we read
    // server-side for log enrichment.
    const [clientStream, loggingStream] = (result.stream as ReadableStream).tee()

    // Kick off background processing to read the stream and persist enriched logs
    const processingPromise = (async () => {
      try {
        // The stream is only used to properly drain it and prevent memory leaks
        // All the execution data is already provided from the agent handler
        // through the X-Execution-Data header
        await drainStream(loggingStream)
        
        // No need to wait for a processing promise
        // The execution-logger.ts will handle token estimation
        
        // We can use the execution data as-is since it's already properly structured
        const executionData = result.execution as any

        // Before persisting, clean up any response objects with zero tokens in agent blocks
        // This prevents confusion in the console logs
        if (executionData.logs && Array.isArray(executionData.logs)) {
          executionData.logs.forEach((log: BlockLog) => {
            if (log.blockType === 'agent' && log.output?.response) {
              const response = log.output.response;
              
              // Check for zero tokens that will be estimated later
              if (response.tokens && 
                 (!response.tokens.completion || response.tokens.completion === 0) &&
                 (!response.toolCalls || !response.toolCalls.list || response.toolCalls.list.length === 0)) {
                
                // Remove tokens from console display to avoid confusion
                // They'll be properly estimated in the execution logger
                delete response.tokens;
              }
            }
          });
        }

        // Build trace spans and persist
        const { traceSpans, totalDuration } = buildTraceSpans(executionData)
        const enrichedResult = {
          ...executionData,
          traceSpans,
          totalDuration,
        }

        const executionId = uuidv4()
        await persistExecutionLogs(workflowId, executionId, enrichedResult, 'chat')
        logger.debug(`[${requestId}] Persisted execution logs for streaming chat with ID: ${executionId}`)
        
        return { success: true }
      } catch (error) {
        logger.error(`[${requestId}] Failed to persist streaming chat execution logs:`, error)
        return { success: false, error }
      } finally {
        // Ensure the stream is properly closed even if an error occurs
        try {
          const controller = new AbortController()
          const signal = controller.signal
          controller.abort()
        } catch (cleanupError) {
          logger.debug(`[${requestId}] Error during stream cleanup: ${cleanupError}`)
        }
      }
    })()
    
    // Register this processing promise with a global handler or tracker if needed
    // This allows the background task to be monitored or waited for in testing
    if (typeof global.__chatStreamProcessingTasks !== 'undefined') {
      global.__chatStreamProcessingTasks.push(processingPromise as Promise<{success: boolean, error?: any}>)
    }

    // Return the client-facing stream
    return clientStream
  }
  
  // Mark as chat execution in metadata
  if (result) {
    (result as any).metadata = {
      ...(result.metadata || {}),
      source: 'chat'
    }
  }
  
  // Persist execution logs using the 'chat' trigger type for non-streaming results
  try {
    // Build trace spans to enrich the logs (same as in use-workflow-execution.ts)
    const { traceSpans, totalDuration } = buildTraceSpans(result)
    
    // Create enriched result with trace data
    const enrichedResult = {
      ...result,
      traceSpans,
      totalDuration,
    }
    
    // Generate a unique execution ID for this chat interaction
    const executionId = uuidv4()
    
    // Persist the logs with 'chat' trigger type
    await persistExecutionLogs(workflowId, executionId, enrichedResult, 'chat')
    
    logger.debug(`[${requestId}] Persisted execution logs for chat with ID: ${executionId}`)
  } catch (error) {
    // Don't fail the chat response if logging fails
    logger.error(`[${requestId}] Failed to persist chat execution logs:`, error)
  }
  
  if (!result.success) {
    logger.error(`[${requestId}] Workflow execution failed:`, result.error)
    throw new Error(`Workflow execution failed: ${result.error}`)
  }
  
  logger.debug(`[${requestId}] Workflow executed successfully, blocks executed: ${result.logs?.length || 0}`)
  
  // Get the outputs from all selected blocks
  let outputs: {content: any}[] = []
  let hasFoundOutputs = false
  
  if (outputBlockIds.length > 0 && result.logs) {
    logger.debug(`[${requestId}] Looking for outputs from ${outputBlockIds.length} configured blocks`)
    
    // Extract outputs from each selected block
    for (let i = 0; i < outputBlockIds.length; i++) {
      const blockId = outputBlockIds[i]
      const path = outputPaths[i] || undefined
      
      logger.debug(`[${requestId}] Looking for output from block ${blockId} with path ${path || 'none'}`)
      
      // Find the block log entry
      const blockLog = result.logs.find(log => log.blockId === blockId)
      if (!blockLog || !blockLog.output) {
        logger.debug(`[${requestId}] No output found for block ${blockId}`)
        continue
      }
      
      // Extract the specific path if provided
      let specificOutput = blockLog.output
      if (path) {
        logger.debug(`[${requestId}] Extracting path ${path} from output`)
        const pathParts = path.split('.')
        for (const part of pathParts) {
          if (specificOutput === null || specificOutput === undefined || typeof specificOutput !== 'object') {
            logger.debug(`[${requestId}] Cannot extract path ${part}, output is not an object`)
            specificOutput = null
            break
          }
          specificOutput = specificOutput[part]
        }
      }
      
      if (specificOutput !== null && specificOutput !== undefined) {
        logger.debug(`[${requestId}] Found output for block ${blockId}`)
        outputs.push({
          content: specificOutput
        })
        hasFoundOutputs = true
      }
    }
  }
  
  // If no specific outputs were found, use the final result
  if (!hasFoundOutputs) {
    logger.debug(`[${requestId}] No specific outputs found, using final output`)
    if (result.output) {
      if (result.output.response) {
        outputs.push({
          content: result.output.response
        })
      } else {
        outputs.push({
          content: result.output
        })
      }
    }
  }
  
  // Simplify the response format to match what the chat panel expects
  if (outputs.length === 1) {
    const content = outputs[0].content
    // Don't wrap strings in an object
    if (typeof content === 'string') {
      return {
        id: uuidv4(),
        content: content,
        timestamp: new Date().toISOString(),
        type: 'workflow'
      }
    }
    // Return the content directly - avoid extra nesting
    return {
      id: uuidv4(),
      content: content,
      timestamp: new Date().toISOString(),
      type: 'workflow'
    }
  } else if (outputs.length > 1) {
    // For multiple outputs, create a structured object that can be handled better by the client
    // This approach allows the client to decide how to render multiple outputs
    return {
      id: uuidv4(),
      multipleOutputs: true,
      contents: outputs.map(o => o.content),
      timestamp: new Date().toISOString(),
      type: 'workflow'
    }
  } else {
    // Fallback for no outputs - should rarely happen
    return {
      id: uuidv4(),
      content: "No output returned from workflow",
      timestamp: new Date().toISOString(),
      type: 'workflow'
    }
  }
}

/**
 * Utility function to properly drain a stream to prevent memory leaks
 */
async function drainStream(stream: ReadableStream): Promise<void> {
  const reader = stream.getReader()
  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      // We don't need to do anything with the value, just drain the stream
    }
  } finally {
    reader.releaseLock()
  }
} 