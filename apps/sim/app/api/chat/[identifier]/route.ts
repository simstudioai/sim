import { db } from '@sim/db'
import { chat, workflow, workspace } from '@sim/db/schema'
import { eq } from 'drizzle-orm'
import { type NextRequest, NextResponse } from 'next/server'
import { v4 as uuidv4 } from 'uuid'
import { z } from 'zod'
import { createLogger } from '@/lib/logs/console/logger'
import { LoggingSession } from '@/lib/logs/execution/logging-session'
import { ChatFiles } from '@/lib/uploads'
import { generateRequestId } from '@/lib/utils'
import {
  addCorsHeaders,
  setChatAuthCookie,
  validateAuthToken,
  validateChatAuth,
} from '@/app/api/chat/utils'
import { createErrorResponse, createSuccessResponse } from '@/app/api/workflows/utils'

const logger = createLogger('ChatIdentifierAPI')

const chatFileSchema = z.object({
  name: z.string().min(1, 'File name is required'),
  type: z.string().min(1, 'File type is required'),
  size: z.number().positive('File size must be positive'),
  data: z.string().min(1, 'File data is required'),
  lastModified: z.number().optional(),
})

const chatPostBodySchema = z.object({
  input: z.string().optional(),
  password: z.string().optional(),
  email: z.string().email('Invalid email format').optional().or(z.literal('')),
  conversationId: z.string().optional(),
  files: z.array(chatFileSchema).optional().default([]),
})

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ identifier: string }> }
) {
  const { identifier } = await params
  const requestId = generateRequestId()

  try {
    logger.debug(`[${requestId}] Processing chat request for identifier: ${identifier}`)

    let parsedBody
    try {
      const rawBody = await request.json()
      const validation = chatPostBodySchema.safeParse(rawBody)

      if (!validation.success) {
        const errorMessage = validation.error.errors
          .map((err) => `${err.path.join('.')}: ${err.message}`)
          .join(', ')
        logger.warn(`[${requestId}] Validation error: ${errorMessage}`)
        return addCorsHeaders(
          createErrorResponse(`Invalid request body: ${errorMessage}`, 400),
          request
        )
      }

      parsedBody = validation.data
    } catch (_error) {
      return addCorsHeaders(createErrorResponse('Invalid request body', 400), request)
    }

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

    if (!deployment.isActive) {
      logger.warn(`[${requestId}] Chat is not active: ${identifier}`)

      const executionId = uuidv4()
      const loggingSession = new LoggingSession(
        deployment.workflowId,
        executionId,
        'chat',
        requestId
      )

      await loggingSession.safeStart({
        userId: deployment.userId,
        workspaceId: '', // Will be resolved if needed
        variables: {},
      })

      await loggingSession.safeCompleteWithError({
        error: {
          message: 'This chat is currently unavailable. The chat has been disabled.',
          stackTrace: undefined,
        },
        traceSpans: [],
      })

      return addCorsHeaders(createErrorResponse('This chat is currently unavailable', 403), request)
    }

    const authResult = await validateChatAuth(requestId, deployment, request, parsedBody)
    if (!authResult.authorized) {
      return addCorsHeaders(
        createErrorResponse(authResult.error || 'Authentication required', 401),
        request
      )
    }

    const { input, password, email, conversationId, files } = parsedBody

    if ((password || email) && !input) {
      const response = addCorsHeaders(createSuccessResponse({ authenticated: true }), request)

      setChatAuthCookie(response, deployment.id, deployment.authType)

      return response
    }

    if (!input && (!files || files.length === 0)) {
      return addCorsHeaders(createErrorResponse('No input provided', 400), request)
    }

    const workflowResult = await db
      .select({
        isDeployed: workflow.isDeployed,
        workspaceId: workflow.workspaceId,
        variables: workflow.variables,
      })
      .from(workflow)
      .where(eq(workflow.id, deployment.workflowId))
      .limit(1)

    if (workflowResult.length === 0 || !workflowResult[0].isDeployed) {
      logger.warn(`[${requestId}] Workflow not found or not deployed: ${deployment.workflowId}`)

      const executionId = uuidv4()
      const loggingSession = new LoggingSession(
        deployment.workflowId,
        executionId,
        'chat',
        requestId
      )

      await loggingSession.safeStart({
        userId: deployment.userId,
        workspaceId: workflowResult[0]?.workspaceId || '',
        variables: {},
      })

      await loggingSession.safeCompleteWithError({
        error: {
          message: 'Chat workflow is not available. The workflow is not deployed.',
          stackTrace: undefined,
        },
        traceSpans: [],
      })

      return addCorsHeaders(createErrorResponse('Chat workflow is not available', 503), request)
    }

    let workspaceOwnerId = deployment.userId
    if (workflowResult[0].workspaceId) {
      const workspaceData = await db
        .select({ ownerId: workspace.ownerId })
        .from(workspace)
        .where(eq(workspace.id, workflowResult[0].workspaceId))
        .limit(1)

      if (workspaceData.length === 0) {
        logger.error(`[${requestId}] Workspace not found for workflow ${deployment.workflowId}`)

        const executionId = uuidv4()
        const loggingSession = new LoggingSession(
          deployment.workflowId,
          executionId,
          'chat',
          requestId
        )

        await loggingSession.safeStart({
          userId: deployment.userId,
          workspaceId: workflowResult[0].workspaceId || '',
          variables: {},
        })

        await loggingSession.safeCompleteWithError({
          error: {
            message: 'Workspace not found. Critical configuration error - please contact support.',
            stackTrace: undefined,
          },
          traceSpans: [],
        })

        return addCorsHeaders(createErrorResponse('Workspace not found', 500), request)
      }

      workspaceOwnerId = workspaceData[0].ownerId
    }

    try {
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

      const executionId = crypto.randomUUID()

      const workflowInput: any = { input, conversationId }
      if (files && Array.isArray(files) && files.length > 0) {
        const executionContext = {
          workspaceId: workflowResult[0].workspaceId || '',
          workflowId: deployment.workflowId,
          executionId,
        }

        try {
          const uploadedFiles = await ChatFiles.processChatFiles(
            files,
            executionContext,
            requestId,
            deployment.userId
          )

          if (uploadedFiles.length > 0) {
            workflowInput.files = uploadedFiles
            logger.info(`[${requestId}] Successfully processed ${uploadedFiles.length} files`)
          }
        } catch (fileError: any) {
          logger.error(`[${requestId}] Failed to process chat files:`, fileError)

          const fileLoggingSession = new LoggingSession(
            deployment.workflowId,
            executionId,
            'chat',
            requestId
          )

          await fileLoggingSession.safeStart({
            userId: workspaceOwnerId,
            workspaceId: workflowResult[0].workspaceId || '',
            variables: {},
          })

          await fileLoggingSession.safeCompleteWithError({
            error: {
              message: `File upload failed: ${fileError.message || 'Unable to process uploaded files'}`,
              stackTrace: fileError.stack,
            },
            traceSpans: [],
          })

          throw fileError
        }
      }

      const workflowForExecution = {
        id: deployment.workflowId,
        userId: deployment.userId,
        workspaceId: workflowResult[0].workspaceId,
        isDeployed: true,
        variables: workflowResult[0].variables || {},
      }

      const stream = await createStreamingResponse({
        requestId,
        workflow: workflowForExecution,
        input: workflowInput,
        executingUserId: workspaceOwnerId,
        streamConfig: {
          selectedOutputs,
          isSecureMode: true,
          workflowTriggerType: 'chat',
        },
        createFilteredResult,
        executionId,
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

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ identifier: string }> }
) {
  const { identifier } = await params
  const requestId = generateRequestId()

  try {
    logger.debug(`[${requestId}] Fetching chat info for identifier: ${identifier}`)

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

    if (!deployment.isActive) {
      logger.warn(`[${requestId}] Chat is not active: ${identifier}`)
      return addCorsHeaders(createErrorResponse('This chat is currently unavailable', 403), request)
    }

    const cookieName = `chat_auth_${deployment.id}`
    const authCookie = request.cookies.get(cookieName)

    if (
      deployment.authType !== 'public' &&
      authCookie &&
      validateAuthToken(authCookie.value, deployment.id)
    ) {
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
