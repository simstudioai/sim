import { NextResponse } from 'next/server'
import { createLogger } from '@/lib/logs/console-logger'

export const dynamic = 'force-dynamic'

const logger = createLogger('teams-channels')

interface Channel {
  id: string
  displayName: string
}

export async function POST(request: Request) {
  try {
    const { credential, teamId } = await request.json()

    if (!credential) {
      logger.error('Missing credential in request')
      return NextResponse.json({ error: 'Credential is required' }, { status: 400 })
    }

    if (!teamId) {
      logger.error('Missing team ID in request')
      return NextResponse.json({ error: 'Team ID is required' }, { status: 400 })
    }

    const tokenResponse = await fetch('/api/auth/oauth/token', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        credentialId: credential,
      }),
    })

    if (!tokenResponse.ok) {
      const errorData = await tokenResponse.json()
      throw new Error(errorData.error || 'Failed to get access token')
    }

    const tokenData = await tokenResponse.json()
    const accessToken = tokenData.accessToken

    const response = await fetch(`https://graph.microsoft.com/v1.0/teams/${teamId}/channels`, {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
    })
    const data = await response.json()
    const channels = data.value

    return NextResponse.json({
      channels: channels
    })
  } catch (error) {
    logger.error('Error processing Channels request:', error)
    return NextResponse.json(
      {
        error: 'Failed to retrieve Microsoft Teams channels',
        details: (error as Error).message,
      },
      { status: 500 }
    )
  }
} 