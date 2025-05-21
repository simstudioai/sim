import { NextResponse } from 'next/server'
import { createLogger } from '@/lib/logs/console-logger'

export const dynamic = 'force-dynamic'

const logger = createLogger('teams-teams')

interface Team {
  id: string
  displayName: string
}
export async function POST(request: Request) {
  try {
    const { credential } = await request.json()

    if (!credential) {
      logger.error('Missing credential in request')
      return NextResponse.json({ error: 'Credential is required' }, { status: 400 })
    }

    // In a real implementation, you would use the credential to authenticate with Microsoft Graph API
    // For now, we'll return some mock data
    logger.info('Fetching teams with credential')

    
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

    const response = await fetch('https://graph.microsoft.com/v1.0/me/joinedTeams', {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
    })
    const data = await response.json()
    const teams = data.value
    


    return NextResponse.json({
      teams: teams
    })
  } catch (error) {
    logger.error('Error processing Teams request:', error)
    return NextResponse.json(
      {
        error: 'Failed to retrieve Microsoft Teams teams',
        details: (error as Error).message,
      },
      { status: 500 }
    )
  }
} 