import { createLogger } from '@sim/logger'
import { NextResponse } from 'next/server'
import { authorizeCredentialUse } from '@/lib/auth/credential-access'
import { generateRequestId } from '@/lib/core/utils/request'
import { refreshAccessTokenIfNeeded } from '@/app/api/auth/oauth/utils'

const logger = createLogger('TrelloBoardsAPI')

export const dynamic = 'force-dynamic'

export async function POST(request: Request) {
  const requestId = generateRequestId()
  try {
    const apiKey = process.env.TRELLO_API_KEY
    if (!apiKey) {
      logger.error('Trello API key not configured')
      return NextResponse.json({ error: 'Trello API key not configured' }, { status: 500 })
    }
    const body = await request.json()
    const { credential, workflowId } = body

    if (!credential) {
      logger.error('Missing credential in request')
      return NextResponse.json({ error: 'Credential is required' }, { status: 400 })
    }

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
      requestId
    )
    if (!accessToken) {
      logger.error('Failed to get access token', {
        credentialId: credential,
        userId: authz.credentialOwnerUserId,
      })
      return NextResponse.json(
        { error: 'Could not retrieve access token', authRequired: true },
        { status: 401 }
      )
    }

    const response = await fetch(
      `https://api.trello.com/1/members/me/boards?key=${apiKey}&token=${accessToken}&fields=id,name,closed`,
      {
        headers: {
          Accept: 'application/json',
        },
      }
    )

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}))
      logger.error('Failed to fetch Trello boards', {
        status: response.status,
        error: errorData,
      })
      return NextResponse.json(
        { error: 'Failed to fetch Trello boards', details: errorData },
        { status: response.status }
      )
    }

    const data = await response.json()
    const boards = (data || []).map((board: { id: string; name: string; closed: boolean }) => ({
      id: board.id,
      name: board.name,
      closed: board.closed,
    }))

    return NextResponse.json({ boards })
  } catch (error) {
    logger.error('Error processing Trello boards request:', error)
    return NextResponse.json(
      { error: 'Failed to retrieve Trello boards', details: (error as Error).message },
      { status: 500 }
    )
  }
}
