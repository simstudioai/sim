import { createLogger } from '@sim/logger'
import { NextResponse } from 'next/server'
import { authorizeCredentialUse } from '@/lib/auth/credential-access'
import { validateMondayNumericId } from '@/lib/core/security/input-validation'
import { generateRequestId } from '@/lib/core/utils/request'
import { refreshAccessTokenIfNeeded } from '@/app/api/auth/oauth/utils'

export const dynamic = 'force-dynamic'

const logger = createLogger('MondayGroupsAPI')

export async function POST(request: Request) {
  try {
    const requestId = generateRequestId()
    const body = await request.json()
    const { credential, boardId, workflowId } = body

    if (!credential || !boardId) {
      logger.error('Missing credential or boardId in request')
      return NextResponse.json({ error: 'Credential and boardId are required' }, { status: 400 })
    }

    const boardIdValidation = validateMondayNumericId(boardId, 'boardId')
    if (!boardIdValidation.isValid) {
      return NextResponse.json({ error: boardIdValidation.error }, { status: 400 })
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
        query: `{ boards(ids: [${boardIdValidation.sanitized}]) { groups { id title } } }`,
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

    const board = data.data?.boards?.[0]
    const groups = (board?.groups || []).map((group: { id: string; title: string }) => ({
      id: group.id,
      name: group.title,
    }))

    return NextResponse.json({ groups })
  } catch (error) {
    logger.error('Error processing Monday groups request:', error)
    return NextResponse.json(
      { error: 'Failed to retrieve Monday groups', details: (error as Error).message },
      { status: 500 }
    )
  }
}
