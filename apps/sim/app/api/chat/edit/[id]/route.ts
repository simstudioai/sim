import { and, eq } from 'drizzle-orm'
import type { NextRequest } from 'next/server'
import { z } from 'zod'
import { getSession } from '@/lib/auth'
import { isDev } from '@/lib/environment'
import { createLogger } from '@/lib/logs/console-logger'
import { getBaseDomain } from '@/lib/urls/utils'
import { encryptSecret } from '@/lib/utils'
import { createErrorResponse, createSuccessResponse } from '@/app/api/workflows/utils'
import { db } from '@/db'
import { chat } from '@/db/schema'

export const dynamic = 'force-dynamic'

const logger = createLogger('ChatDetailAPI')

// Schema for updating an existing chat
const chatUpdateSchema = z.object({
  workflowId: z.string().min(1, 'Workflow ID is required').optional(),
  subdomain: z
    .string()
    .min(1, 'Subdomain is required')
    .regex(/^[a-z0-9-]+$/, 'Subdomain can only contain lowercase letters, numbers, and hyphens')
    .optional(),
  title: z.string().min(1, 'Title is required').optional(),
  description: z.string().optional(),
  customizations: z
    .object({
      primaryColor: z.string(),
      welcomeMessage: z.string(),
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

    // Get the specific chat deployment
    const chatInstance = await db
      .select()
      .from(chat)
      .where(and(eq(chat.id, chatId), eq(chat.userId, session.user.id)))
      .limit(1)

    if (chatInstance.length === 0) {
      return createErrorResponse('Chat not found or access denied', 404)
    }

    // Create a new result object without the password
    const { password, ...safeData } = chatInstance[0]

    const chatUrl = isDev
      ? `http://${chatInstance[0].subdomain}.${getBaseDomain()}`
      : `https://${chatInstance[0].subdomain}.simstudio.ai`

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

      // Verify the chat exists and belongs to the user
      const existingChat = await db
        .select()
        .from(chat)
        .where(and(eq(chat.id, chatId), eq(chat.userId, session.user.id)))
        .limit(1)

      if (existingChat.length === 0) {
        return createErrorResponse('Chat not found or access denied', 404)
      }

      // Extract validated data
      const {
        workflowId,
        subdomain,
        title,
        description,
        customizations,
        authType,
        password,
        allowedEmails,
        outputConfigs,
      } = validatedData

      // Check if subdomain is changing and if it's available
      if (subdomain && subdomain !== existingChat[0].subdomain) {
        const existingSubdomain = await db
          .select()
          .from(chat)
          .where(eq(chat.subdomain, subdomain))
          .limit(1)

        if (existingSubdomain.length > 0 && existingSubdomain[0].id !== chatId) {
          return createErrorResponse('Subdomain already in use', 400)
        }
      }

      // Handle password update
      let encryptedPassword

      // Only encrypt and update password if one is provided
      if (password) {
        const { encrypted } = await encryptSecret(password)
        encryptedPassword = encrypted
        logger.info('Password provided, will be updated')
      } else if (authType === 'password' && !password) {
        // If switching to password auth but no password provided,
        // check if there's an existing password
        if (existingChat[0].authType !== 'password' || !existingChat[0].password) {
          // If there's no existing password to reuse, return an error
          return createErrorResponse('Password is required when using password protection', 400)
        }
        logger.info('Keeping existing password')
      }

      // Prepare update data
      const updateData: any = {
        updatedAt: new Date(),
      }

      // Only include fields that are provided
      if (workflowId) updateData.workflowId = workflowId
      if (subdomain) updateData.subdomain = subdomain
      if (title) updateData.title = title
      if (description !== undefined) updateData.description = description
      if (customizations) updateData.customizations = customizations

      // Handle auth type update
      if (authType) {
        updateData.authType = authType

        // Reset auth-specific fields when changing auth types
        if (authType === 'public') {
          updateData.password = null
          updateData.allowedEmails = []
        } else if (authType === 'password') {
          updateData.allowedEmails = []
          // Password handled separately
        } else if (authType === 'email') {
          updateData.password = null
          // Emails handled separately
        }
      }

      // Always update password if provided (not just when changing auth type)
      if (encryptedPassword) {
        updateData.password = encryptedPassword
      }

      // Always update allowed emails if provided
      if (allowedEmails) {
        updateData.allowedEmails = allowedEmails
      }

      // Handle output fields
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

      // Update the chat deployment
      await db.update(chat).set(updateData).where(eq(chat.id, chatId))

      const updatedSubdomain = subdomain || existingChat[0].subdomain

      const chatUrl = isDev
        ? `http://${updatedSubdomain}.${getBaseDomain()}`
        : `https://${updatedSubdomain}.simstudio.ai`

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

    // Verify the chat exists and belongs to the user
    const existingChat = await db
      .select()
      .from(chat)
      .where(and(eq(chat.id, chatId), eq(chat.userId, session.user.id)))
      .limit(1)

    if (existingChat.length === 0) {
      return createErrorResponse('Chat not found or access denied', 404)
    }

    // Delete the chat deployment
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
