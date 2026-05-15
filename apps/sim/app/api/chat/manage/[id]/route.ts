import { AuditAction, AuditResourceType, recordAudit } from '@sim/audit'
import { db } from '@sim/db'
import { chat } from '@sim/db/schema'
import { createLogger } from '@sim/logger'
import { getErrorMessage } from '@sim/utils/errors'
import { and, eq, isNull } from 'drizzle-orm'
import type { NextRequest } from 'next/server'
import { chatIdParamsSchema, updateChatContract } from '@/lib/api/contracts/chats'
import { getValidationErrorMessage, parseRequest } from '@/lib/api/server'
import { getSession } from '@/lib/auth'
import { isDev } from '@/lib/core/config/feature-flags'
import { encryptSecret } from '@/lib/core/security/encryption'
import { getEmailDomain } from '@/lib/core/utils/urls'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'
import { performChatUndeploy, performFullDeploy } from '@/lib/workflows/orchestration'
import { checkChatAccess } from '@/app/api/chat/utils'
import { createErrorResponse, createSuccessResponse } from '@/app/api/workflows/utils'

export const dynamic = 'force-dynamic'
export const maxDuration = 120

const logger = createLogger('ChatDetailAPI')

/**
 * GET endpoint to fetch a specific chat deployment by ID
 */
export const GET = withRouteHandler(
  async (_request: NextRequest, { params }: { params: Promise<{ id: string }> }) => {
    const { id } = chatIdParamsSchema.parse(await params)
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
    } catch (error) {
      logger.error('Error fetching chat deployment:', error)
      return createErrorResponse(getErrorMessage(error, 'Failed to fetch chat deployment'), 500)
    }
  }
)

/**
 * PATCH endpoint to update an existing chat deployment
 */
export const PATCH = withRouteHandler(
  async (request: NextRequest, context: { params: Promise<{ id: string }> }) => {
    try {
      const session = await getSession()

      if (!session) {
        return createErrorResponse('Unauthorized', 401)
      }

      const parsed = await parseRequest(updateChatContract, request, context, {
        validationErrorResponse: (error) =>
          createErrorResponse(getValidationErrorMessage(error), 400, 'VALIDATION_ERROR'),
      })
      if (!parsed.success) return parsed.response

      const { id: chatId } = parsed.data.params
      const validatedData = parsed.data.body

      const {
        hasAccess,
        chat: existingChatRecord,
        workspaceId: chatWorkspaceId,
      } = await checkChatAccess(chatId, session.user.id)

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

      if (workflowId && workflowId !== existingChat[0].workflowId) {
        return createErrorResponse('Changing the workflow of a chat deployment is not allowed', 400)
      }

      if (identifier && identifier !== existingChat[0].identifier) {
        const existingIdentifier = await db
          .select()
          .from(chat)
          .where(and(eq(chat.identifier, identifier), isNull(chat.archivedAt)))
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

      // Redeploy the workflow to ensure latest version is active
      const deployResult = await performFullDeploy({
        workflowId: existingChat[0].workflowId,
        userId: session.user.id,
        request,
      })

      if (!deployResult.success) {
        logger.warn(`Failed to redeploy workflow for chat update: ${deployResult.error}`)
        const status =
          deployResult.errorCode === 'validation'
            ? 400
            : deployResult.errorCode === 'not_found'
              ? 404
              : 500
        return createErrorResponse(deployResult.error || 'Failed to redeploy workflow', status)
      }
      logger.info(
        `Redeployed workflow ${existingChat[0].workflowId} for chat update (v${deployResult.version})`
      )

      const updateData: Record<string, unknown> = {
        updatedAt: new Date(),
      }

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
        } else if (authType === 'email' || authType === 'sso') {
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

      const emailCount = Array.isArray(updateData.allowedEmails)
        ? updateData.allowedEmails.length
        : undefined
      const outputConfigsCount = Array.isArray(updateData.outputConfigs)
        ? updateData.outputConfigs.length
        : undefined

      logger.info('Updating chat deployment with values:', {
        chatId,
        authType: updateData.authType,
        hasPassword: updateData.password !== undefined,
        emailCount,
        outputConfigsCount,
      })

      await db.update(chat).set(updateData).where(eq(chat.id, chatId))

      const updatedIdentifier = identifier || existingChat[0].identifier

      const baseDomain = getEmailDomain()
      const protocol = isDev ? 'http' : 'https'
      const chatUrl = `${protocol}://${baseDomain}/chat/${updatedIdentifier}`

      logger.info(`Chat "${chatId}" updated successfully`)

      recordAudit({
        workspaceId: chatWorkspaceId || null,
        actorId: session.user.id,
        actorName: session.user.name,
        actorEmail: session.user.email,
        action: AuditAction.CHAT_UPDATED,
        resourceType: AuditResourceType.CHAT,
        resourceId: chatId,
        resourceName: title || existingChatRecord.title,
        description: `Updated chat deployment "${title || existingChatRecord.title}"`,
        metadata: {
          identifier: updatedIdentifier,
          authType: updateData.authType || existingChatRecord.authType,
          workflowId: workflowId || existingChatRecord.workflowId,
          chatUrl,
        },
        request,
      })

      return createSuccessResponse({
        id: chatId,
        chatUrl,
        message: 'Chat deployment updated successfully',
      })
    } catch (error) {
      logger.error('Error updating chat deployment:', error)
      return createErrorResponse(getErrorMessage(error, 'Failed to update chat deployment'), 500)
    }
  }
)

/**
 * DELETE endpoint to remove a chat deployment
 */
export const DELETE = withRouteHandler(
  async (_request: NextRequest, { params }: { params: Promise<{ id: string }> }) => {
    const { id } = chatIdParamsSchema.parse(await params)
    const chatId = id

    try {
      const session = await getSession()

      if (!session) {
        return createErrorResponse('Unauthorized', 401)
      }

      const { hasAccess, workspaceId: chatWorkspaceId } = await checkChatAccess(
        chatId,
        session.user.id
      )

      if (!hasAccess) {
        return createErrorResponse('Chat not found or access denied', 404)
      }

      const result = await performChatUndeploy({
        chatId,
        userId: session.user.id,
        workspaceId: chatWorkspaceId,
      })

      if (!result.success) {
        return createErrorResponse(result.error || 'Failed to delete chat', 500)
      }

      return createSuccessResponse({
        message: 'Chat deployment deleted successfully',
      })
    } catch (error) {
      logger.error('Error deleting chat deployment:', error)
      return createErrorResponse(getErrorMessage(error, 'Failed to delete chat deployment'), 500)
    }
  }
)
