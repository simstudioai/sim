import { db } from '@sim/db'
import { chat } from '@sim/db/schema'
import { createLogger } from '@sim/logger'
import { getErrorMessage } from '@sim/utils/errors'
import { and, eq, isNull } from 'drizzle-orm'
import type { NextRequest } from 'next/server'
import { createChatContract } from '@/lib/api/contracts/chats'
import { getValidationErrorMessage, parseRequest } from '@/lib/api/server'
import { getSession } from '@/lib/auth'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'
import { performChatDeploy } from '@/lib/workflows/orchestration'
import { checkWorkflowAccessForChatCreation } from '@/app/api/chat/utils'
import { createErrorResponse, createSuccessResponse } from '@/app/api/workflows/utils'

const logger = createLogger('ChatAPI')

export const GET = withRouteHandler(async (_request: NextRequest) => {
  try {
    const session = await getSession()

    if (!session) {
      return createErrorResponse('Unauthorized', 401)
    }

    // Get the user's chat deployments
    const deployments = await db
      .select()
      .from(chat)
      .where(and(eq(chat.userId, session.user.id), isNull(chat.archivedAt)))

    return createSuccessResponse({ deployments })
  } catch (error) {
    logger.error('Error fetching chat deployments:', error)
    return createErrorResponse(getErrorMessage(error, 'Failed to fetch chat deployments'), 500)
  }
})

export const POST = withRouteHandler(async (request: NextRequest) => {
  try {
    const session = await getSession()

    if (!session) {
      return createErrorResponse('Unauthorized', 401)
    }

    const parsed = await parseRequest(
      createChatContract,
      request,
      {},
      {
        validationErrorResponse: (error) =>
          createErrorResponse(getValidationErrorMessage(error), 400, 'VALIDATION_ERROR'),
      }
    )
    if (!parsed.success) return parsed.response

    const {
      workflowId,
      identifier,
      title,
      description = '',
      customizations,
      authType = 'public',
      password,
      allowedEmails = [],
      outputConfigs = [],
    } = parsed.data.body

    if (authType === 'password' && !password) {
      return createErrorResponse('Password is required when using password protection', 400)
    }

    if (authType === 'email' && (!Array.isArray(allowedEmails) || allowedEmails.length === 0)) {
      return createErrorResponse(
        'At least one email or domain is required when using email access control',
        400
      )
    }

    if (authType === 'sso' && (!Array.isArray(allowedEmails) || allowedEmails.length === 0)) {
      return createErrorResponse(
        'At least one email or domain is required when using SSO access control',
        400
      )
    }

    const [existingIdentifier, { hasAccess, workflow: workflowRecord }] = await Promise.all([
      db
        .select()
        .from(chat)
        .where(and(eq(chat.identifier, identifier), isNull(chat.archivedAt)))
        .limit(1),
      checkWorkflowAccessForChatCreation(workflowId, session.user.id),
    ])

    if (existingIdentifier.length > 0) {
      return createErrorResponse('Identifier already in use', 400)
    }

    if (!hasAccess || !workflowRecord) {
      return createErrorResponse('Workflow not found or access denied', 404)
    }

    const result = await performChatDeploy({
      workflowId,
      userId: session.user.id,
      identifier,
      title,
      description,
      customizations,
      authType,
      password,
      allowedEmails,
      outputConfigs,
      workspaceId: workflowRecord.workspaceId,
    })

    if (!result.success) {
      return createErrorResponse(result.error || 'Failed to deploy chat', 500)
    }

    return createSuccessResponse({
      id: result.chatId,
      chatId: result.chatId,
      chatUrl: result.chatUrl,
      message: 'Chat deployment created successfully',
    })
  } catch (error) {
    logger.error('Error creating chat deployment:', error)
    return createErrorResponse(getErrorMessage(error, 'Failed to create chat deployment'), 500)
  }
})
