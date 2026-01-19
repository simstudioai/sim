import { NextResponse } from 'next/server'
import { authorizeCredentialUse } from '@/lib/auth/credential-access'
import { generateRequestId } from '@/lib/core/utils/request'
import { createLogger } from '@/lib/logs/console/logger'
import { refreshAccessTokenIfNeeded } from '@/app/api/auth/oauth/utils'

export const dynamic = 'force-dynamic'

const logger = createLogger('PinterestBoardsAPI')

interface PinterestBoard {
  id: string
  name: string
  description?: string
  privacy?: string
  owner?: {
    username: string
  }
}

export async function POST(request: Request) {
  try {
    const requestId = generateRequestId()
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
        {
          error: 'Could not retrieve access token',
          authRequired: true,
        },
        { status: 401 }
      )
    }

    logger.info('Fetching Pinterest boards', { requestId })

    const response = await fetch('https://api.pinterest.com/v5/boards', {
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
    })

    if (!response.ok) {
      const errorText = await response.text()
      logger.error('Pinterest API error', {
        status: response.status,
        statusText: response.statusText,
        error: errorText,
      })
      return NextResponse.json(
        { error: `Pinterest API error: ${response.status} - ${response.statusText}` },
        { status: response.status }
      )
    }

    const data = await response.json()
    const boards = (data.items || []).map((board: PinterestBoard) => ({
      id: board.id,
      name: board.name,
      description: board.description,
      privacy: board.privacy,
    }))

    logger.info(`Successfully fetched ${boards.length} Pinterest boards`, { requestId })
    return NextResponse.json({ items: boards })
  } catch (error) {
    logger.error('Error processing Pinterest boards request:', error)
    return NextResponse.json(
      { error: 'Failed to retrieve Pinterest boards', details: (error as Error).message },
      { status: 500 }
    )
  }
}
