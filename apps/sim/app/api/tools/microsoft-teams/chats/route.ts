import { createLogger } from '@sim/logger'
import { NextResponse } from 'next/server'
import { authorizeCredentialUse } from '@/lib/auth/credential-access'
import { validateMicrosoftGraphId } from '@/lib/core/security/input-validation'
import { refreshAccessTokenIfNeeded } from '@/app/api/auth/oauth/utils'

export const dynamic = 'force-dynamic'

const logger = createLogger('TeamsChatsAPI')

/**
 * Helper function to get chat members and create a meaningful name
 *
 * @param chatId - Microsoft Teams chat ID to get display name for
 * @param accessToken - Access token for Microsoft Graph API
 * @param chatTopic - Optional existing chat topic
 * @returns A meaningful display name for the chat
 */
const getChatDisplayName = async (
  chatId: string,
  accessToken: string,
  chatTopic?: string
): Promise<string> => {
  try {
    const chatIdValidation = validateMicrosoftGraphId(chatId, 'chatId')
    if (!chatIdValidation.isValid) {
      logger.warn('Invalid chat ID in getChatDisplayName', {
        error: chatIdValidation.error,
        chatId: chatId.substring(0, 50),
      })
      return `Chat ${chatId.substring(0, 8)}...`
    }

    if (chatTopic?.trim() && chatTopic !== 'null') {
      return chatTopic
    }

    const membersResponse = await fetch(
      `https://graph.microsoft.com/v1.0/chats/${encodeURIComponent(chatId)}/members`,
      {
        method: 'GET',
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
        },
      }
    )

    if (membersResponse.ok) {
      const membersData = await membersResponse.json()
      const members = membersData.value || []

      const memberNames = members
        .filter((member: any) => member.displayName && member.displayName !== 'Unknown')
        .map((member: any) => member.displayName)
        .slice(0, 3)

      if (memberNames.length > 0) {
        if (memberNames.length === 1) {
          return memberNames[0]
        }
        if (memberNames.length === 2) {
          return memberNames.join(' & ')
        }
        return `${memberNames.slice(0, 2).join(', ')} & ${memberNames.length - 2} more`
      }
    }

    try {
      const messagesResponse = await fetch(
        `https://graph.microsoft.com/v1.0/chats/${encodeURIComponent(chatId)}/messages?$top=10&$orderby=createdDateTime desc`,
        {
          method: 'GET',
          headers: {
            Authorization: `Bearer ${accessToken}`,
            'Content-Type': 'application/json',
          },
        }
      )

      if (messagesResponse.ok) {
        const messagesData = await messagesResponse.json()
        const messages = messagesData.value || []

        for (const message of messages) {
          if (message.eventDetail?.chatDisplayName) {
            return message.eventDetail.chatDisplayName
          }
        }

        const senderNames = [
          ...new Set(
            messages
              .filter(
                (msg: any) => msg.from?.user?.displayName && msg.from.user.displayName !== 'Unknown'
              )
              .map((msg: any) => msg.from.user.displayName)
          ),
        ].slice(0, 3)

        if (senderNames.length > 0) {
          if (senderNames.length === 1) {
            return senderNames[0] as string
          }
          if (senderNames.length === 2) {
            return senderNames.join(' & ')
          }
          return `${senderNames.slice(0, 2).join(', ')} & ${senderNames.length - 2} more`
        }
      }
    } catch (error) {
      logger.warn(
        `Failed to get better name from messages for chat ${chatId}: ${error instanceof Error ? error.message : String(error)}`
      )
    }

    return `Chat ${chatId.split(':')[0] || chatId.substring(0, 8)}...`
  } catch (error) {
    logger.warn(
      `Failed to get display name for chat ${chatId}: ${error instanceof Error ? error.message : String(error)}`
    )
    return `Chat ${chatId.split(':')[0] || chatId.substring(0, 8)}...`
  }
}

export async function POST(request: Request) {
  try {
    const body = await request.json()

    const { credential, workflowId } = body

    if (!credential) {
      logger.error('Missing credential in request')
      return NextResponse.json({ error: 'Credential is required' }, { status: 400 })
    }

    try {
      const authz = await authorizeCredentialUse(request as any, {
        credentialId: credential,
        workflowId,
      })
      if (!authz.ok || !authz.credentialOwnerUserId) {
        return NextResponse.json({ error: authz.error || 'Unauthorized' }, { status: 403 })
      }
      const accessToken = await refreshAccessTokenIfNeeded(
        credential,
        authz.credentialOwnerUserId,
        'TeamsChatsAPI'
      )

      if (!accessToken) {
        logger.error('Failed to get access token', {
          credentialId: credential,
          userId: authz.credentialOwnerUserId,
        })
        return NextResponse.json({ error: 'Could not retrieve access token' }, { status: 401 })
      }

      const response = await fetch('https://graph.microsoft.com/v1.0/me/chats', {
        method: 'GET',
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
        },
      })

      if (!response.ok) {
        const errorData = await response.json()
        logger.error('Microsoft Graph API error getting chats', {
          status: response.status,
          error: errorData,
          endpoint: 'https://graph.microsoft.com/v1.0/me/chats',
        })

        if (response.status === 401) {
          return NextResponse.json(
            {
              error: 'Authentication failed. Please reconnect your Microsoft Teams account.',
              authRequired: true,
            },
            { status: 401 }
          )
        }

        throw new Error(`Microsoft Graph API error: ${JSON.stringify(errorData)}`)
      }

      const data = await response.json()

      const chats = await Promise.all(
        data.value.map(async (chat: any) => ({
          id: chat.id,
          displayName: await getChatDisplayName(chat.id, accessToken, chat.topic),
        }))
      )

      return NextResponse.json({
        chats: chats,
      })
    } catch (innerError) {
      logger.error('Error during API requests:', innerError)

      const errorMessage = innerError instanceof Error ? innerError.message : String(innerError)
      if (
        errorMessage.includes('auth') ||
        errorMessage.includes('token') ||
        errorMessage.includes('unauthorized') ||
        errorMessage.includes('unauthenticated')
      ) {
        return NextResponse.json(
          {
            error: 'Authentication failed. Please reconnect your Microsoft Teams account.',
            authRequired: true,
            details: errorMessage,
          },
          { status: 401 }
        )
      }

      throw innerError
    }
  } catch (error) {
    logger.error('Error processing Chats request:', error)
    return NextResponse.json(
      {
        error: 'Failed to retrieve Microsoft Teams chats',
        details: (error as Error).message,
      },
      { status: 500 }
    )
  }
}
