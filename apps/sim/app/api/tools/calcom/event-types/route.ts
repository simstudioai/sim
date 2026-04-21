import { createLogger } from '@sim/logger'
import { NextResponse } from 'next/server'
import { authorizeCredentialUse } from '@/lib/auth/credential-access'
import { generateRequestId } from '@/lib/core/utils/request'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'
import { refreshAccessTokenIfNeeded } from '@/app/api/auth/oauth/utils'

const logger = createLogger('CalcomEventTypesAPI')

export const dynamic = 'force-dynamic'

export const POST = withRouteHandler(async (request: Request) => {
  const requestId = generateRequestId()
  try {
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

    const response = await fetch('https://api.cal.com/v2/event-types', {
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
        'cal-api-version': '2024-06-14',
      },
    })

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}))
      logger.error('Failed to fetch Cal.com event types', {
        status: response.status,
        error: errorData,
      })
      return NextResponse.json(
        { error: 'Failed to fetch Cal.com event types', details: errorData },
        { status: response.status }
      )
    }

    const data = await response.json()
    const eventTypes = (data.data || []).map(
      (eventType: { id: number; title: string; slug: string }) => ({
        id: String(eventType.id),
        title: eventType.title,
        slug: eventType.slug,
      })
    )

    return NextResponse.json({ eventTypes })
  } catch (error) {
    logger.error('Error processing Cal.com event types request:', error)
    return NextResponse.json(
      { error: 'Failed to retrieve Cal.com event types', details: (error as Error).message },
      { status: 500 }
    )
  }
})
