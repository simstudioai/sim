import { createLogger } from '@sim/logger'
import { type NextRequest, NextResponse } from 'next/server'
import { authorizeCredentialUse } from '@/lib/auth/credential-access'
import { generateRequestId } from '@/lib/core/utils/request'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'
import { refreshAccessTokenIfNeeded } from '@/app/api/auth/oauth/utils'

const logger = createLogger('TrelloBoardsAPI')

export const dynamic = 'force-dynamic'

export const POST = withRouteHandler(async (request: NextRequest) => {
  const requestId = generateRequestId()
  try {
    const apiKey = process.env.TRELLO_API_KEY
    if (!apiKey) {
      logger.error('Trello API key not configured')
      return NextResponse.json({ error: 'Trello API key not configured' }, { status: 500 })
    }
    const body = (await request.json().catch(() => null)) as {
      credential?: string
      workflowId?: string
    } | null
    const credential = typeof body?.credential === 'string' ? body.credential : ''
    const workflowId = typeof body?.workflowId === 'string' ? body.workflowId : undefined

    if (!credential) {
      logger.error('Missing credential in request')
      return NextResponse.json({ error: 'Credential is required' }, { status: 400 })
    }

    const authz = await authorizeCredentialUse(request, {
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
      const errorData = await response.json().catch(() => null)
      logger.error('Failed to fetch Trello boards', {
        status: response.status,
        error: errorData,
      })
      return NextResponse.json(
        { error: 'Failed to fetch Trello boards', details: errorData },
        { status: response.status }
      )
    }

    const data = (await response.json().catch(() => null)) as unknown

    if (!Array.isArray(data)) {
      logger.error('Trello returned an invalid board collection', { data })
      return NextResponse.json({ error: 'Invalid Trello board response' }, { status: 502 })
    }

    const boards = data.flatMap((board) => {
      if (typeof board !== 'object' || board === null) {
        return []
      }

      const record = board as Record<string, unknown>
      if (typeof record.id !== 'string' || typeof record.name !== 'string') {
        return []
      }

      return [
        {
          id: record.id,
          name: record.name,
          closed: typeof record.closed === 'boolean' ? record.closed : false,
        },
      ]
    })

    return NextResponse.json({ boards })
  } catch (error) {
    logger.error('Error processing Trello boards request:', error)
    return NextResponse.json(
      { error: 'Failed to retrieve Trello boards', details: (error as Error).message },
      { status: 500 }
    )
  }
})
