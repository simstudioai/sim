import { NextResponse } from 'next/server'
import { getSession } from '@/lib/auth'
import { createLogger } from '@/lib/logs/console/logger'
import { refreshAccessTokenIfNeeded } from '@/app/api/auth/oauth/utils'

export const dynamic = 'force-dynamic'

const logger = createLogger('teams-chats')

// Helper function to get chat members and create a meaningful name
const getChatDisplayName = async (
  chatId: string,
  accessToken: string,
  chatTopic?: string
): Promise<string> => {
  try {
    // If the chat already has a topic, use it
    if (chatTopic?.trim() && chatTopic !== 'null') {
      return chatTopic
    }

    // Fetch chat members to create a meaningful name
    const membersResponse = await fetch(
      `https://graph.microsoft.com/v1.0/chats/${chatId}/members`,
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

      // Filter out the current user and get display names
      const memberNames = members
        .filter((member: any) => member.displayName && member.displayName !== 'Unknown')
        .map((member: any) => member.displayName)
        .slice(0, 3) // Limit to first 3 names to avoid very long names

      if (memberNames.length > 0) {
        if (memberNames.length === 1) {
          return memberNames[0] // 1:1 chat
        }
        if (memberNames.length === 2) {
          return memberNames.join(' & ') // 2-person group
        }
        return `${memberNames.slice(0, 2).join(', ')} & ${memberNames.length - 2} more` // Larger group
      }
    }

    // Fallback: try to get a better name from recent messages
    try {
      const messagesResponse = await fetch(
        `https://graph.microsoft.com/v1.0/chats/${chatId}/messages?$top=10&$orderby=createdDateTime desc`,
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

        // Look for chat rename events
        for (const message of messages) {
          if (message.eventDetail?.chatDisplayName) {
            return message.eventDetail.chatDisplayName
          }
        }

        // Get unique sender names from recent messages as last resort
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

    // Final fallback
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
    const session = await getSession()
    const body = await request.json()

    const { credential } = body

    if (!credential) {
      logger.error('Missing credential in request')
      return NextResponse.json({ error: 'Credential is required' }, { status: 400 })
    }

    try {
      // Get the userId either from the session or from the workflowId
      const userId = session?.user?.id || ''

      if (!userId) {
        logger.error('No user ID found in session')
        return NextResponse.json({ error: 'Authentication required' }, { status: 401 })
      }

      const accessToken = await refreshAccessTokenIfNeeded(credential, userId, body.workflowId)

      if (!accessToken) {
        logger.error('Failed to get access token', { credentialId: credential, userId })
        return NextResponse.json({ error: 'Could not retrieve access token' }, { status: 401 })
      }

      // Now try to fetch the chats
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

        // Check for auth errors specifically
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

      // Process chats with enhanced display names
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

      // Check if it's an authentication error
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
