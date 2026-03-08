import { createLogger } from '@sim/logger'
import { NextResponse } from 'next/server'
import { authorizeCredentialUse } from '@/lib/auth/credential-access'
import { generateRequestId } from '@/lib/core/utils/request'
import { refreshAccessTokenIfNeeded } from '@/app/api/auth/oauth/utils'

const logger = createLogger('ZoomMeetingsAPI')

export const dynamic = 'force-dynamic'

export async function POST(request: Request) {
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

    const response = await fetch(
      'https://api.zoom.us/v2/users/me/meetings?page_size=300&type=scheduled',
      {
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
        },
      }
    )

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}))
      logger.error('Failed to fetch Zoom meetings', {
        status: response.status,
        error: errorData,
      })
      return NextResponse.json(
        { error: 'Failed to fetch Zoom meetings', details: errorData },
        { status: response.status }
      )
    }

    const data = await response.json()
    const meetings = (data.meetings || []).map((meeting: { id: number; topic: string }) => ({
      id: String(meeting.id),
      name: meeting.topic,
    }))

    return NextResponse.json({ meetings })
  } catch (error) {
    logger.error('Error processing Zoom meetings request:', error)
    return NextResponse.json(
      { error: 'Failed to retrieve Zoom meetings', details: (error as Error).message },
      { status: 500 }
    )
  }
}
