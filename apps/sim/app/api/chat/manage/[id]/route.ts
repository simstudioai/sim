import { db } from '@sim/db'
import { chat } from '@sim/db/schema'
import { eq } from 'drizzle-orm'
import type { NextRequest } from 'next/server'
import { z } from 'zod'
import { getSession } from '@/lib/auth'
import { isDev } from '@/lib/environment'
import { createLogger } from '@/lib/logs/console/logger'
import { getEmailDomain } from '@/lib/urls/utils'
import { encryptSecret } from '@/lib/utils'
import { checkChatAccess } from '@/app/api/chat/utils'
import { createErrorResponse, createSuccessResponse } from '@/app/api/workflows/utils'

export const dynamic = 'force-dynamic'

const logger = createLogger('ChatDetailAPI')

const chatUpdateSchema = z.object({
  workflowId: z.string().min(1, 'Workflow ID is required').optional(),
  identifier: z
    .string()
    .min(1, 'Identifier is required')
    .regex(/^[a-z0-9-]+$/, 'Identifier can only contain lowercase letters, numbers, and hyphens')
    .optional(),
  title: z.string().min(1, 'Title is required').optional(),
  description: z.string().optional(),
  customizations: z
    .object({
      primaryColor: z.string(),
      welcomeMessage: z.string(),
      imageUrl: z.string().optional(),
    })
    .optional(),
  authType: z.enum(['public', 'password', 'email']).optional(),
  password: z.string().optional(),
  allowedEmails: z.array(z.string()).optional(),
  outputConfigs: z
    .array(
      z.object({
        blockId: z.string(),
        path: z.string(),
      })
    )
    .optional(),
})

/**
 * GET endpoint to fetch a specific chat deployment by ID
 */
export async function GET(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const chatId = id

  try {
    const session = await getSession()

    if (!session) {
      return createErrorResponse('Unauthorized', 401)
    }

    const { hasAccess, chat: chatRecord } = await checkChatAccess(chatId, session.user.id)

    if (!hasAccess || !chatRecord) {
      return createErrorResponse('Chat not found or access denied', 404)
    }

    const { password, ...safeData } = chatRecord

    const baseDomain = getEmailDomain()
    const protocol = isDev ? 'http' : 'https'
    const chatUrl = `${protocol}://${baseDomain}/chat/${chatRecord.identifier}`

    const result = {
      ...safeData,
      chatUrl,
      hasPassword: !!password,
    }

    return createSuccessResponse(result)
  } catch (error: any) {
    logger.error('Error fetching chat deployment:', error)
    return createErrorResponse(error.message || 'Failed to fetch chat deployment', 500)
  }
}

/**
 * PATCH endpoint to update an existing chat deployment
 */
export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const chatId = id

  try {
    const session = await getSession()

    if (!session) {
      return createErrorResponse('Unauthorized', 401)
    }

    const body = await request.json()

    try {
      const validatedData = chatUpdateSchema.parse(body)

      const { hasAccess, chat: existingChatRecord } = await checkChatAccess(chatId, session.user.id)

      if (!hasAccess || !existingChatRecord) {
        return createErrorResponse('Chat not found or access denied', 404)
      }

      const existingChat = [existingChatRecord]

      const {
        workflowId,
        identifier,
        title,
        description,
        customizations,
        authType,
        password,
        allowedEmails,
        outputConfigs,
      } = validatedData

      if (identifier && identifier !== existingChat[0].identifier) {
        const existingIdentifier = await db
          .select()
          .from(chat)
          .where(eq(chat.identifier, identifier))
          .limit(1)

        if (existingIdentifier.length > 0 && existingIdentifier[0].id !== chatId) {
          return createErrorResponse('Identifier already in use', 400)
        }
      }

      let encryptedPassword

      if (password) {
        const { encrypted } = await encryptSecret(password)
        encryptedPassword = encrypted
        logger.info('Password provided, will be updated')
      } else if (authType === 'password' && !password) {
        if (existingChat[0].authType !== 'password' || !existingChat[0].password) {
          return createErrorResponse('Password is required when using password protection', 400)
        }
        logger.info('Keeping existing password')
      }

      const updateData: any = {
        updatedAt: new Date(),
      }

      if (workflowId) updateData.workflowId = workflowId
      if (identifier) updateData.identifier = identifier
      if (title) updateData.title = title
      if (description !== undefined) updateData.description = description
      if (customizations) updateData.customizations = customizations

      if (authType) {
        updateData.authType = authType

        if (authType === 'public') {
          updateData.password = null
          updateData.allowedEmails = []
        } else if (authType === 'password') {
          updateData.allowedEmails = []
        } else if (authType === 'email') {
          updateData.password = null
        }
      }

      if (encryptedPassword) {
        updateData.password = encryptedPassword
      }

      if (allowedEmails) {
        updateData.allowedEmails = allowedEmails
      }

      if (outputConfigs) {
        updateData.outputConfigs = outputConfigs
      }

      logger.info('Updating chat deployment with values:', {
        chatId,
        authType: updateData.authType,
        hasPassword: updateData.password !== undefined,
        emailCount: updateData.allowedEmails?.length,
        outputConfigsCount: updateData.outputConfigs ? updateData.outputConfigs.length : undefined,
      })

      await db.update(chat).set(updateData).where(eq(chat.id, chatId))

      const updatedIdentifier = identifier || existingChat[0].identifier

      const baseDomain = getEmailDomain()
      const protocol = isDev ? 'http' : 'https'
      const chatUrl = `${protocol}://${baseDomain}/chat/${updatedIdentifier}`

      logger.info(`Chat "${chatId}" updated successfully`)

      return createSuccessResponse({
        id: chatId,
        chatUrl,
        message: 'Chat deployment updated successfully',
      })
    } catch (validationError) {
      if (validationError instanceof z.ZodError) {
        const errorMessage = validationError.errors[0]?.message || 'Invalid request data'
        return createErrorResponse(errorMessage, 400, 'VALIDATION_ERROR')
      }
      throw validationError
    }
  } catch (error: any) {
    logger.error('Error updating chat deployment:', error)
    return createErrorResponse(error.message || 'Failed to update chat deployment', 500)
  }
}

/**
 * DELETE endpoint to remove a chat deployment
 */
export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params
  const chatId = id

  try {
    const session = await getSession()

    if (!session) {
      return createErrorResponse('Unauthorized', 401)
    }

    const { hasAccess } = await checkChatAccess(chatId, session.user.id)

    if (!hasAccess) {
      return createErrorResponse('Chat not found or access denied', 404)
    }

    await db.delete(chat).where(eq(chat.id, chatId))

    logger.info(`Chat "${chatId}" deleted successfully`)

    return createSuccessResponse({
      message: 'Chat deployment deleted successfully',
    })
  } catch (error: any) {
    logger.error('Error deleting chat deployment:', error)
    return createErrorResponse(error.message || 'Failed to delete chat deployment', 500)
  }
}
