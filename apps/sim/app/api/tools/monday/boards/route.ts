import { createLogger } from '@sim/logger'
import { type NextRequest, NextResponse } from 'next/server'
import { mondayBoardsSelectorContract } from '@/lib/api/contracts/selectors'
import { parseRequest } from '@/lib/api/server'
import { authorizeCredentialUse } from '@/lib/auth/credential-access'
import { generateRequestId } from '@/lib/core/utils/request'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'
import { refreshAccessTokenIfNeeded } from '@/app/api/auth/oauth/utils'

export const dynamic = 'force-dynamic'

const logger = createLogger('MondayBoardsAPI')

interface MondayGraphQLError {
  message?: string
}

interface MondayBoardsResponse {
  errors?: MondayGraphQLError[]
  error_message?: string
  data?: {
    boards?: Array<{
      id: string
      name: string
    }>
  }
}

export const POST = withRouteHandler(async (request: NextRequest) => {
  try {
    const requestId = generateRequestId()
    const parsed = await parseRequest(mondayBoardsSelectorContract, request, {})
    if (!parsed.success) return parsed.response
    const { credential, workflowId } = parsed.data.body

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

    const data = (await response.json()) as MondayBoardsResponse

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

    const boards = (data.data?.boards || []).map((board) => ({
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
