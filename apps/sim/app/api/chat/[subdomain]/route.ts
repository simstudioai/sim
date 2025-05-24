import { eq } from 'drizzle-orm'
import { type NextRequest, NextResponse } from 'next/server'
import { createLogger } from '@/lib/logs/console-logger'
import { createErrorResponse, createSuccessResponse } from '@/app/api/workflows/utils'
import { db } from '@/db'
import { chat, workflow } from '@/db/schema'
import {
  addCorsHeaders,
  executeWorkflowForChat,
  setChatAuthCookie,
  validateAuthToken,
  validateChatAuth,
} from '../utils'

const logger = createLogger('ChatSubdomainAPI')

// This endpoint handles chat interactions via the subdomain
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ subdomain: string }> }
) {
  const { subdomain } = await params
  const requestId = crypto.randomUUID().slice(0, 8)

  try {
    logger.debug(`[${requestId}] Processing chat request for subdomain: ${subdomain}`)

    // Parse the request body once
    let parsedBody
    try {
      parsedBody = await request.json()
    } catch (_error) {
      return addCorsHeaders(createErrorResponse('Invalid request body', 400), request)
    }

    // Find the chat deployment for this subdomain
    const deploymentResult = await db
      .select({
        id: chat.id,
        workflowId: chat.workflowId,
        userId: chat.userId,
        isActive: chat.isActive,
        authType: chat.authType,
        password: chat.password,
        allowedEmails: chat.allowedEmails,
        outputConfigs: chat.outputConfigs,
      })
      .from(chat)
      .where(eq(chat.subdomain, subdomain))
      .limit(1)

    if (deploymentResult.length === 0) {
      logger.warn(`[${requestId}] Chat not found for subdomain: ${subdomain}`)
      return addCorsHeaders(createErrorResponse('Chat not found', 404), request)
    }

    const deployment = deploymentResult[0]

    // Check if the chat is active
    if (!deployment.isActive) {
      logger.warn(`[${requestId}] Chat is not active: ${subdomain}`)
      return addCorsHeaders(createErrorResponse('This chat is currently unavailable', 403), request)
    }

    // Validate authentication with the parsed body
    const authResult = await validateChatAuth(requestId, deployment, request, parsedBody)
    if (!authResult.authorized) {
      return addCorsHeaders(
        createErrorResponse(authResult.error || 'Authentication required', 401),
        request
      )
    }

    // Use the already parsed body
    const { message, password, email, conversationId } = parsedBody

    // If this is an authentication request (has password or email but no message),
    // set auth cookie and return success
    if ((password || email) && !message) {
      const response = addCorsHeaders(createSuccessResponse({ authenticated: true }), request)

      // Set authentication cookie
      setChatAuthCookie(response, deployment.id, deployment.authType)

      return response
    }

    // For chat messages, create regular response
    if (!message) {
      return addCorsHeaders(createErrorResponse('No message provided', 400), request)
    }

    // Get the workflow for this chat
    const workflowResult = await db
      .select({
        isDeployed: workflow.isDeployed,
      })
      .from(workflow)
      .where(eq(workflow.id, deployment.workflowId))
      .limit(1)

    if (workflowResult.length === 0 || !workflowResult[0].isDeployed) {
      logger.warn(`[${requestId}] Workflow not found or not deployed: ${deployment.workflowId}`)
      return addCorsHeaders(createErrorResponse('Chat workflow is not available', 503), request)
    }

    try {
      // Execute workflow with structured input (message + conversationId for context)
      const result = await executeWorkflowForChat(deployment.id, message, conversationId)

      // If the executor returned a ReadableStream, stream it directly to the client
      if (result instanceof ReadableStream) {
        const streamResponse = new NextResponse(result, {
          status: 200,
          headers: {
            'Content-Type': 'text/plain; charset=utf-8',
          },
        })
        return addCorsHeaders(streamResponse, request)
      }

      // Handle StreamingExecution format
      if (result && typeof result === 'object' && 'stream' in result && 'execution' in result) {
        const streamResponse = new NextResponse(result.stream as ReadableStream, {
          status: 200,
          headers: {
            'Content-Type': 'text/plain; charset=utf-8',
          },
        })
        return addCorsHeaders(streamResponse, request)
      }

      // Format the result for the client
      // If result.content is an object, preserve it for structured handling
      // If it's text or another primitive, make sure it's accessible
      let formattedResult: any = { output: null }

      if (result) {
        // Check if we have multiple outputs
        if (result.multipleOutputs && Array.isArray(result.contents)) {
          // Format multiple outputs in a way that they can be displayed as separate messages
          // Join all contents, ensuring each is on a new line if they're strings
          const formattedContents = result.contents.map((content) => {
            if (typeof content === 'string') {
              return content
            }

            try {
              return JSON.stringify(content)
            } catch (error) {
              logger.warn(`[${requestId}] Error stringifying content:`, error)
              return '[Object cannot be serialized]'
            }
          })

          // Set output to be the joined contents
          formattedResult = {
            ...result,
            output: formattedContents.join('\n\n'), // Separate each output with double newline
          }

          // Keep the original contents for clients that can handle structured data
          formattedResult.multipleOutputs = true
          formattedResult.contents = result.contents
        } else if (result.content) {
          // Handle single output cases
          if (typeof result.content === 'object') {
            // For objects like { text: "some content" }
            if (result.content.text) {
              formattedResult.output = result.content.text
            } else {
              // Keep the original structure but also add an output field
              try {
                formattedResult = {
                  ...result,
                  output: JSON.stringify(result.content),
                }
              } catch (error) {
                logger.warn(`[${requestId}] Error stringifying content:`, error)
                formattedResult = {
                  ...result,
                  output: '[Object cannot be serialized]',
                }
              }
            }
          } else {
            // For direct string content
            formattedResult = {
              ...result,
              output: result.content,
            }
          }
        } else {
          // Fallback if no content
          formattedResult = {
            ...result,
            output: 'No output returned from workflow',
          }
        }
      }

      logger.info(`[${requestId}] Returning formatted chat response:`, {
        hasOutput: !!formattedResult.output,
        outputType: typeof formattedResult.output,
        isMultipleOutputs: !!formattedResult.multipleOutputs,
      })

      // Add CORS headers before returning the response
      return addCorsHeaders(createSuccessResponse(formattedResult), request)
    } catch (error: any) {
      logger.error(`[${requestId}] Error processing chat request:`, error)
      return addCorsHeaders(
        createErrorResponse(error.message || 'Failed to process request', 500),
        request
      )
    }
  } catch (error: any) {
    logger.error(`[${requestId}] Error processing chat request:`, error)
    return addCorsHeaders(
      createErrorResponse(error.message || 'Failed to process request', 500),
      request
    )
  }
}

// This endpoint returns information about the chat
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ subdomain: string }> }
) {
  const { subdomain } = await params
  const requestId = crypto.randomUUID().slice(0, 8)

  try {
    logger.debug(`[${requestId}] Fetching chat info for subdomain: ${subdomain}`)

    // Find the chat deployment for this subdomain
    const deploymentResult = await db
      .select({
        id: chat.id,
        title: chat.title,
        description: chat.description,
        customizations: chat.customizations,
        isActive: chat.isActive,
        workflowId: chat.workflowId,
        authType: chat.authType,
        password: chat.password,
        allowedEmails: chat.allowedEmails,
        outputConfigs: chat.outputConfigs,
      })
      .from(chat)
      .where(eq(chat.subdomain, subdomain))
      .limit(1)

    if (deploymentResult.length === 0) {
      logger.warn(`[${requestId}] Chat not found for subdomain: ${subdomain}`)
      return addCorsHeaders(createErrorResponse('Chat not found', 404), request)
    }

    const deployment = deploymentResult[0]

    // Check if the chat is active
    if (!deployment.isActive) {
      logger.warn(`[${requestId}] Chat is not active: ${subdomain}`)
      return addCorsHeaders(createErrorResponse('This chat is currently unavailable', 403), request)
    }

    // Check for auth cookie first
    const cookieName = `chat_auth_${deployment.id}`
    const authCookie = request.cookies.get(cookieName)

    if (
      deployment.authType !== 'public' &&
      authCookie &&
      validateAuthToken(authCookie.value, deployment.id)
    ) {
      // Cookie valid, return chat info
      return addCorsHeaders(
        createSuccessResponse({
          id: deployment.id,
          title: deployment.title,
          description: deployment.description,
          customizations: deployment.customizations,
          authType: deployment.authType,
        }),
        request
      )
    }

    // If no valid cookie, proceed with standard auth check
    const authResult = await validateChatAuth(requestId, deployment, request)
    if (!authResult.authorized) {
      logger.info(
        `[${requestId}] Authentication required for chat: ${subdomain}, type: ${deployment.authType}`
      )
      return addCorsHeaders(
        createErrorResponse(authResult.error || 'Authentication required', 401),
        request
      )
    }

    // Return public information about the chat including auth type
    return addCorsHeaders(
      createSuccessResponse({
        id: deployment.id,
        title: deployment.title,
        description: deployment.description,
        customizations: deployment.customizations,
        authType: deployment.authType,
      }),
      request
    )
  } catch (error: any) {
    logger.error(`[${requestId}] Error fetching chat info:`, error)
    return addCorsHeaders(
      createErrorResponse(error.message || 'Failed to fetch chat information', 500),
      request
    )
  }
}
