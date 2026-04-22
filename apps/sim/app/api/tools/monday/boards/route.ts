import { createLogger } from '@sim/logger'
import { NextResponse } from 'next/server'
import { authorizeCredentialUse } from '@/lib/auth/credential-access'
import { generateRequestId } from '@/lib/core/utils/request'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'
import { refreshAccessTokenIfNeeded } from '@/app/api/auth/oauth/utils'

export const dynamic = 'force-dynamic'

const logger = createLogger('MondayBoardsAPI')

export const POST = withRouteHandler(async (request: Request) => {
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
        { error: 'Could not retrieve access token', authRequired: true },
        { status: 401 }
      )
    }

    const response = await fetch('https://api.monday.com/v2', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: accessToken,
        'API-Version': '2024-10',
      },
      body: JSON.stringify({
        query: '{ boards(limit: 100, state: active) { id name } }',
      }),
    })

    const data = await response.json()

    if (data.errors?.length) {
      logger.error('Monday.com API error', { errors: data.errors })
      return NextResponse.json(
        { error: data.errors[0].message || 'Monday.com API error' },
        { status: 500 }
      )
    }

    if (data.error_message) {
      logger.error('Monday.com API error', { error_message: data.error_message })
      return NextResponse.json({ error: data.error_message }, { status: 500 })
    }

    const boards = (data.data?.boards || []).map((board: { id: string; name: string }) => ({
      id: board.id,
      name: board.name,
    }))

    return NextResponse.json({ boards })
  } catch (error) {
    logger.error('Error processing Monday boards request:', error)
    return NextResponse.json(
      { error: 'Failed to retrieve Monday boards', details: (error as Error).message },
      { status: 500 }
    )
  }
})
