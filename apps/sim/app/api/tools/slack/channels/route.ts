import { NextResponse } from 'next/server'
import { getSession } from '@/lib/auth'
import { createLogger } from '@/lib/logs/console-logger'
import { refreshAccessTokenIfNeeded } from '@/app/api/auth/oauth/utils'

export const dynamic = 'force-dynamic'

const logger = createLogger('SlackChannelsAPI')

interface SlackChannel {
  id: string
  name: string
  is_private: boolean
  is_archived: boolean
  is_member: boolean
}

export async function POST(request: Request) {
  try {
    const session = await getSession()
    const body = await request.json()
    const { credential, workflowId } = body

    if (!credential) {
      logger.error('Missing credential in request')
      return NextResponse.json({ error: 'Credential is required' }, { status: 400 })
    }

    let accessToken: string

    // Check if the credential is a bot token (starts with 'xoxb-')
    if (credential.startsWith('xoxb-')) {
      // Direct bot token
      accessToken = credential
      logger.info('Using direct bot token for Slack API')
    } else {
      // OAuth credential - need to resolve it
      const userId = session?.user?.id || ''
      if (!userId) {
        logger.error('No user ID found in session')
        return NextResponse.json({ error: 'Authentication required' }, { status: 401 })
      }

      const resolvedToken = await refreshAccessTokenIfNeeded(credential, userId, workflowId)
      if (!resolvedToken) {
        logger.error('Failed to get access token', { credentialId: credential, userId })
        return NextResponse.json(
          {
            error: 'Could not retrieve access token',
            authRequired: true,
          },
          { status: 401 }
        )
      }
      accessToken = resolvedToken
      logger.info('Using OAuth token for Slack API')
    }

    // Fetch channels from Slack API
    const response = await fetch('https://slack.com/api/conversations.list', {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
    })

    if (!response.ok) {
      logger.error('Slack API error:', {
        status: response.status,
        statusText: response.statusText,
      })
      return NextResponse.json(
        { error: `Slack API error: ${response.status} ${response.statusText}` },
        { status: response.status }
      )
    }

    const data = await response.json()

    if (!data.ok) {
      logger.error('Slack API returned error:', data.error)
      return NextResponse.json({ error: data.error || 'Failed to fetch channels' }, { status: 400 })
    }

    // Filter to channels the bot can access and format the response
    const channels = data.channels
      .filter((channel: SlackChannel) => !channel.is_archived && channel.is_member)
      .map((channel: SlackChannel) => ({
        id: channel.id,
        name: channel.name,
        isPrivate: channel.is_private,
      }))

    logger.info(`Successfully fetched ${channels.length} Slack channels`)
    return NextResponse.json({ channels })
  } catch (error) {
    logger.error('Error processing Slack channels request:', error)
    return NextResponse.json(
      { error: 'Failed to retrieve Slack channels', details: (error as Error).message },
      { status: 500 }
    )
  }
}
