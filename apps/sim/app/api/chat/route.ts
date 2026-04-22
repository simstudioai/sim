import { db } from '@sim/db'
import { chat } from '@sim/db/schema'
import { createLogger } from '@sim/logger'
import { and, eq, isNull } from 'drizzle-orm'
import type { NextRequest } from 'next/server'
import { z } from 'zod'
import { getSession } from '@/lib/auth'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'
import { performChatDeploy } from '@/lib/workflows/orchestration'
import { checkWorkflowAccessForChatCreation } from '@/app/api/chat/utils'
import { createErrorResponse, createSuccessResponse } from '@/app/api/workflows/utils'

const logger = createLogger('ChatAPI')

const chatSchema = z.object({
  workflowId: z.string().min(1, 'Workflow ID is required'),
  identifier: z
    .string()
    .min(1, 'Identifier is required')
    .regex(/^[a-z0-9-]+$/, 'Identifier can only contain lowercase letters, numbers, and hyphens'),
  title: z.string().min(1, 'Title is required'),
  description: z.string().optional(),
  customizations: z.object({
    primaryColor: z.string(),
    welcomeMessage: z.string(),
    imageUrl: z.string().optional(),
  }),
  authType: z.enum(['public', 'password', 'email', 'sso']).default('public'),
  password: z.string().optional(),
  allowedEmails: z.array(z.string()).optional().default([]),
  outputConfigs: z
    .array(
      z.object({
        blockId: z.string(),
        path: z.string(),
      })
    )
    .optional()
    .default([]),
})

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
  } catch (error: any) {
    logger.error('Error fetching chat deployments:', error)
    return createErrorResponse(error.message || 'Failed to fetch chat deployments', 500)
  }
})

export const POST = withRouteHandler(async (request: NextRequest) => {
  try {
    const session = await getSession()

    if (!session) {
      return createErrorResponse('Unauthorized', 401)
    }

    const body = await request.json()

    try {
      const validatedData = chatSchema.parse(body)

      // Extract validated data
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
      } = validatedData

      // Perform additional validation specific to auth types
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
        chatUrl: result.chatUrl,
        message: 'Chat deployment created successfully',
      })
    } catch (validationError) {
      if (validationError instanceof z.ZodError) {
        const errorMessage = validationError.errors[0]?.message || 'Invalid request data'
        return createErrorResponse(errorMessage, 400, 'VALIDATION_ERROR')
      }
      throw validationError
    }
  } catch (error: any) {
    logger.error('Error creating chat deployment:', error)
    return createErrorResponse(error.message || 'Failed to create chat deployment', 500)
  }
})
