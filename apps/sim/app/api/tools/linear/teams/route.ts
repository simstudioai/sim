import type { Team } from '@linear/sdk'
import { LinearClient } from '@linear/sdk'
import { NextResponse } from 'next/server'
import { getSession } from '@/lib/auth'
import { createLogger } from '@/lib/logs/console-logger'
import { refreshAccessTokenIfNeeded } from '@/app/api/auth/oauth/utils'

export const dynamic = 'force-dynamic'

const logger = createLogger('LinearTeams')

export async function POST(request: Request) {
  try {
    const session = await getSession()
    const body = await request.json()
    const { credential, workflowId } = body

    if (!credential) {
      logger.error('Missing credential in request')
      return NextResponse.json({ error: 'Credential is required' }, { status: 400 })
    }

    const userId = session?.user?.id || ''
    if (!userId) {
      logger.error('No user ID found in session')
      return NextResponse.json({ error: 'Authentication required' }, { status: 401 })
    }

    const accessToken = await refreshAccessTokenIfNeeded(credential, userId, workflowId)
    if (!accessToken) {
      logger.error('Failed to get access token', { credentialId: credential, userId })
      return NextResponse.json(
        {
          error: 'Could not retrieve access token',
          authRequired: true,
        },
        { status: 401 }
      )
    }

    const linearClient = new LinearClient({ accessToken })
    const teamsResult = await linearClient.teams()
    const teams = teamsResult.nodes.map((team: Team) => ({
      id: team.id,
      name: team.name,
    }))

    return NextResponse.json({ teams })
  } catch (error) {
    logger.error('Error processing Linear teams request:', error)
    return NextResponse.json(
      { error: 'Failed to retrieve Linear teams', details: (error as Error).message },
      { status: 500 }
    )
  }
}
