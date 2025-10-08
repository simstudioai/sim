import { db } from '@sim/db'
import { chat, workflow } from '@sim/db/schema'
import { eq } from 'drizzle-orm'
import { type NextRequest, NextResponse } from 'next/server'
import { createLogger } from '@/lib/logs/console/logger'
import { generateRequestId } from '@/lib/utils'
import {
  addCorsHeaders,
  setChatAuthCookie,
  validateAuthToken,
  validateChatAuth,
} from '@/app/api/chat/utils'
import { createErrorResponse, createSuccessResponse } from '@/app/api/workflows/utils'

const logger = createLogger('ChatIdentifierAPI')

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

// This endpoint handles chat interactions via the identifier
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ identifier: string }> }
) {
  const { identifier } = await params
  const requestId = generateRequestId()

  try {
    logger.debug(`[${requestId}] Processing chat request for identifier: ${identifier}`)

    // Parse the request body once
    let parsedBody
    try {
      parsedBody = await request.json()
    } catch (_error) {
      return addCorsHeaders(createErrorResponse('Invalid request body', 400), request)
    }

    // Find the chat deployment for this identifier
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
      .where(eq(chat.identifier, identifier))
      .limit(1)

    if (deploymentResult.length === 0) {
      logger.warn(`[${requestId}] Chat not found for identifier: ${identifier}`)
      return addCorsHeaders(createErrorResponse('Chat not found', 404), request)
    }

    const deployment = deploymentResult[0]

    // Check if the chat is active
    if (!deployment.isActive) {
      logger.warn(`[${requestId}] Chat is not active: ${identifier}`)
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
    const { input, password, email, conversationId } = parsedBody

    // If this is an authentication request (has password or email but no input),
    // set auth cookie and return success
    if ((password || email) && !input) {
      const response = addCorsHeaders(createSuccessResponse({ authenticated: true }), request)

      // Set authentication cookie
      setChatAuthCookie(response, deployment.id, deployment.authType)

      return response
    }

    // For chat messages, create regular response
    if (!input) {
      return addCorsHeaders(createErrorResponse('No input provided', 400), request)
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
      // Transform outputConfigs to selectedOutputs format (blockId_attribute format)
      const selectedOutputs: string[] = []
      if (deployment.outputConfigs && Array.isArray(deployment.outputConfigs)) {
        for (const config of deployment.outputConfigs) {
          const outputId = config.path
            ? `${config.blockId}_${config.path}`
            : `${config.blockId}_content`
          selectedOutputs.push(outputId)
        }
      }

      const { createStreamingResponse } = await import('@/lib/workflows/streaming')
      const { SSE_HEADERS } = await import('@/lib/utils')
      const { createFilteredResult } = await import('@/app/api/workflows/[id]/execute/route')

      const stream = await createStreamingResponse({
        requestId,
        workflow: { id: deployment.workflowId, userId: deployment.userId, isDeployed: true },
        input: { input, conversationId }, // Format for chat_trigger
        executingUserId: deployment.userId, // Use workflow owner's ID for chat deployments
        streamConfig: {
          selectedOutputs,
          isSecureMode: true,
          workflowTriggerType: 'chat',
        },
        createFilteredResult,
      })

      const streamResponse = new NextResponse(stream, {
        status: 200,
        headers: SSE_HEADERS,
      })
      return addCorsHeaders(streamResponse, request)
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
  { params }: { params: Promise<{ identifier: string }> }
) {
  const { identifier } = await params
  const requestId = generateRequestId()

  try {
    logger.debug(`[${requestId}] Fetching chat info for identifier: ${identifier}`)

    // Find the chat deployment for this identifier
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
      .where(eq(chat.identifier, identifier))
      .limit(1)

    if (deploymentResult.length === 0) {
      logger.warn(`[${requestId}] Chat not found for identifier: ${identifier}`)
      return addCorsHeaders(createErrorResponse('Chat not found', 404), request)
    }

    const deployment = deploymentResult[0]

    // Check if the chat is active
    if (!deployment.isActive) {
      logger.warn(`[${requestId}] Chat is not active: ${identifier}`)
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
          outputConfigs: deployment.outputConfigs,
        }),
        request
      )
    }

    // If no valid cookie, proceed with standard auth check
    const authResult = await validateChatAuth(requestId, deployment, request)
    if (!authResult.authorized) {
      logger.info(
        `[${requestId}] Authentication required for chat: ${identifier}, type: ${deployment.authType}`
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
        outputConfigs: deployment.outputConfigs,
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
