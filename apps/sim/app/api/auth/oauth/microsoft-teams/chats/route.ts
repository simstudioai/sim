import { NextResponse } from 'next/server'
import { createLogger } from '@/lib/logs/console-logger'

export const dynamic = 'force-dynamic'

const logger = createLogger('teams-chats')

interface Chat {
  id: string
  displayName: string
}

// Helper function to format chat names
const formatChatName = (chat: any): string => {
  // In a real implementation, this would format a chat name based on participants
  // For now, just return a generic name if no topic is available
  return chat.topic || `Chat ${chat.id}`;
}

export async function POST(request: Request) {
  console.log('POST request received at /api/auth/oauth/microsoft-teams/chats')
  try {
    const body = await request.json()
    logger.info('Request body parsed', { body })
    
    const { credential } = body

    if (!credential) {
      logger.error('Missing credential in request')
      return NextResponse.json({ error: 'Credential is required' }, { status: 400 })
    }

    logger.info('Credential found, attempting to fetch token', { credentialId: credential })

    try {
      // Step 1: Get access token
      const tokenResponse = body.tokenResponse
      
      logger.info('Token response status', { status: tokenResponse.status })
      
      if (!tokenResponse.ok) {
        const errorData = await tokenResponse.json()
        logger.error('Failed to get access token', { status: tokenResponse.status, error: errorData })
        throw new Error(errorData.error || 'Failed to get access token')
      }

      const tokenData = await tokenResponse.json()
      logger.info('Successfully retrieved token')
      const accessToken = tokenData.accessToken

      if (!accessToken) {
        logger.error('Access token is missing in the response', { tokenData })
        throw new Error('Access token is missing in the response')
      }

      // Step 2: Call Microsoft Graph API
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
        logger.error('Microsoft Graph API error', { status: response.status, error: errorData })
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