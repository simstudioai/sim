import { type NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { checkHybridAuth } from '@/lib/auth/hybrid'
import { createLogger } from '@/lib/logs/console/logger'
import { generateRequestId } from '@/lib/utils'

export const dynamic = 'force-dynamic'

const logger = createLogger('TeamsDeleteChatMessageAPI')

const TeamsDeleteChatMessageSchema = z.object({
  accessToken: z.string().min(1, 'Access token is required'),
  chatId: z.string().min(1, 'Chat ID is required'),
  messageId: z.string().min(1, 'Message ID is required'),
})

export async function POST(request: NextRequest) {
  const requestId = generateRequestId()

  try {
    const authResult = await checkHybridAuth(request, { requireWorkflowId: false })

    if (!authResult.success) {
      logger.warn(`[${requestId}] Unauthorized Teams chat delete attempt: ${authResult.error}`)
      return NextResponse.json(
        {
          success: false,
          error: authResult.error || 'Authentication required',
        },
        { status: 401 }
      )
    }

    logger.info(
      `[${requestId}] Authenticated Teams chat message delete request via ${authResult.authType}`,
      {
        userId: authResult.userId,
      }
    )

    const body = await request.json()
    const validatedData = TeamsDeleteChatMessageSchema.parse(body)

    logger.info(`[${requestId}] Deleting Teams chat message`, {
      chatId: validatedData.chatId,
      messageId: validatedData.messageId,
    })

    // First, get the current user's ID (required for chat message deletion endpoint)
    const meUrl = 'https://graph.microsoft.com/v1.0/me'
    const meResponse = await fetch(meUrl, {
      headers: {
        Authorization: `Bearer ${validatedData.accessToken}`,
      },
    })

    if (!meResponse.ok) {
      const errorData = await meResponse.json().catch(() => ({}))
      logger.error(`[${requestId}] Failed to get user ID:`, errorData)
      return NextResponse.json(
        {
          success: false,
          error: errorData.error?.message || 'Failed to get user information',
        },
        { status: meResponse.status }
      )
    }

    const userData = await meResponse.json()
    const userId = userData.id

    logger.info(`[${requestId}] Retrieved user ID: ${userId}`)

    // Now perform the softDelete operation using the correct endpoint format
    const deleteUrl = `https://graph.microsoft.com/v1.0/users/${encodeURIComponent(userId)}/chats/${encodeURIComponent(validatedData.chatId)}/messages/${encodeURIComponent(validatedData.messageId)}/softDelete`

    const deleteResponse = await fetch(deleteUrl, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${validatedData.accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({}), // softDelete requires an empty JSON body
    })

    if (!deleteResponse.ok) {
      const errorData = await deleteResponse.json().catch(() => ({}))
      logger.error(`[${requestId}] Microsoft Teams API delete error:`, errorData)
      return NextResponse.json(
        {
          success: false,
          error: errorData.error?.message || 'Failed to delete Teams message',
        },
        { status: deleteResponse.status }
      )
    }

    logger.info(`[${requestId}] Teams message deleted successfully`)

    return NextResponse.json({
      success: true,
      output: {
        deleted: true,
        messageId: validatedData.messageId,
        metadata: {
          messageId: validatedData.messageId,
          chatId: validatedData.chatId,
        },
      },
    })
  } catch (error) {
    logger.error(`[${requestId}] Error deleting Teams chat message:`, error)
    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error occurred',
      },
      { status: 500 }
    )
  }
}
