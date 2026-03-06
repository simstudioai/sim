import { createLogger } from '@sim/logger'
import { NextResponse } from 'next/server'
import { authorizeCredentialUse } from '@/lib/auth/credential-access'
import { generateRequestId } from '@/lib/core/utils/request'
import { refreshAccessTokenIfNeeded } from '@/app/api/auth/oauth/utils'

const logger = createLogger('PipedrivePipelinesAPI')

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

    const response = await fetch('https://api.pipedrive.com/v1/pipelines', {
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
    })

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}))
      logger.error('Failed to fetch Pipedrive pipelines', {
        status: response.status,
        error: errorData,
      })
      return NextResponse.json(
        { error: 'Failed to fetch Pipedrive pipelines', details: errorData },
        { status: response.status }
      )
    }

    const data = await response.json()
    const pipelines = (data.data || []).map((pipeline: { id: number; name: string }) => ({
      id: String(pipeline.id),
      name: pipeline.name,
    }))

    return NextResponse.json({ pipelines })
  } catch (error) {
    logger.error('Error processing Pipedrive pipelines request:', error)
    return NextResponse.json(
      { error: 'Failed to retrieve Pipedrive pipelines', details: (error as Error).message },
      { status: 500 }
    )
  }
}
