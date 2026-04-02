import { createLogger } from '@sim/logger'
import { NextResponse } from 'next/server'
import { authorizeCredentialUse } from '@/lib/auth/credential-access'
import { generateRequestId } from '@/lib/core/utils/request'
import { getScopesForService } from '@/lib/oauth/utils'
import { refreshAccessTokenIfNeeded, ServiceAccountTokenError } from '@/app/api/auth/oauth/utils'

const logger = createLogger('GoogleTasksTaskListsAPI')

export const dynamic = 'force-dynamic'

export async function POST(request: Request) {
  const requestId = generateRequestId()
  try {
    const body = await request.json()
    const { credential, workflowId, impersonateEmail } = body

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
      requestId,
      getScopesForService('google-tasks'),
      impersonateEmail
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

    const response = await fetch('https://tasks.googleapis.com/tasks/v1/users/@me/lists', {
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
    })

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}))
      logger.error('Failed to fetch Google Tasks task lists', {
        status: response.status,
        error: errorData,
      })
      return NextResponse.json(
        { error: 'Failed to fetch Google Tasks task lists', details: errorData },
        { status: response.status }
      )
    }

    const data = await response.json()
    const taskLists = (data.items || []).map((list: { id: string; title: string }) => ({
      id: list.id,
      title: list.title,
    }))

    return NextResponse.json({ taskLists })
  } catch (error) {
    if (error instanceof ServiceAccountTokenError) {
      return NextResponse.json({ error: error.message }, { status: 400 })
    }
    logger.error('Error processing Google Tasks task lists request:', error)
    return NextResponse.json(
      { error: 'Failed to retrieve Google Tasks task lists', details: (error as Error).message },
      { status: 500 }
    )
  }
}
