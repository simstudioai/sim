import { NextResponse } from 'next/server'
import { createLogger } from '@/lib/logs/console-logger'
import { getBaseUrl } from '@/lib/urls/utils'
import { refreshAccessTokenIfNeeded } from '../../utils'
import { getSession } from '@/lib/auth'

export const dynamic = 'force-dynamic'

const logger = createLogger('teams-chats')

// Helper function to format chat names
const formatChatName = (chat: any): string => {
  // In a real implementation, this would format a chat name based on participants
  // For now, just return a generic name if no topic is available
  return chat.topic || `Chat ${chat.id}`;
}

export async function POST(request: Request) {
  logger.info('POST request received at /api/auth/oauth/microsoft-teams/chats')
  try {
    const session = await getSession()
    const body = await request.json()
    logger.info('Request body parsed', { body })
    
    const { credential } = body

    if (!credential) {
      logger.error('Missing credential in request')
      return NextResponse.json({ error: 'Credential is required' }, { status: 400 })
    }

    logger.info('Credential found, attempting to fetch token', { credentialId: credential })

    try {
      // Get the userId either from the session or from the workflowId
      const userId = session?.user?.id || ''
      
      if (!userId) {
        logger.error('No user ID found in session')
        return NextResponse.json({ error: 'Authentication required' }, { status: 401 })
      }
      
      logger.info('Refreshing token if needed', { userId, credentialId: credential })
      const accessToken = await refreshAccessTokenIfNeeded(credential, userId, body.workflowId)
      
      if (!accessToken) {
        logger.error('Failed to get access token', { credentialId: credential, userId })
        return NextResponse.json({ error: 'Could not retrieve access token' }, { status: 401 })
      }

      logger.info('Successfully obtained access token, calling Microsoft Graph API', { 
        tokenLength: accessToken.length 
      })
      
      // Only log the first 20 chars of the token for security
      logger.info('Authorization header being sent', { 
        header: `Bearer ${accessToken?.substring(0, 20)}...`, 
      })

      // Now try to fetch the chats
      logger.info('Calling Microsoft Graph API to fetch chats')
      const response = await fetch('https://graph.microsoft.com/v1.0/me/chats', {
        method: 'GET',
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
        },
      })
      
      logger.info('Microsoft Graph API response', { status: response.status })
      
      if (!response.ok) {
        const errorData = await response.json()
        logger.error('Microsoft Graph API error getting chats', { 
          status: response.status, 
          error: errorData,
          endpoint: 'https://graph.microsoft.com/v1.0/me/chats'
        })
        
        // Check for auth errors specifically
        if (response.status === 401) {
          return NextResponse.json({ 
            error: 'Authentication failed. Please reconnect your Microsoft Teams account.',
            authRequired: true
          }, { status: 401 });
        }
        
        throw new Error(`Microsoft Graph API error: ${JSON.stringify(errorData)}`)
      }
      
      const data = await response.json()
      logger.info('Successfully retrieved chats data', { count: data.value?.length || 0 })
      
      const chats = data.value.map((chat: any) => ({
        id: chat.id,
        displayName: chat.topic || formatChatName(chat)
      }))

      logger.info('Processed chats data', { count: chats.length })
      
      return NextResponse.json({
        chats: chats
      })
    } catch (innerError) {
      logger.error('Error during API requests:', innerError)
      
      // Check if it's an authentication error
      const errorMessage = innerError instanceof Error ? innerError.message : String(innerError);
      if (errorMessage.includes('auth') || errorMessage.includes('token') || 
          errorMessage.includes('unauthorized') || errorMessage.includes('unauthenticated')) {
        return NextResponse.json({ 
          error: 'Authentication failed. Please reconnect your Microsoft Teams account.',
          authRequired: true,
          details: errorMessage
        }, { status: 401 });
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