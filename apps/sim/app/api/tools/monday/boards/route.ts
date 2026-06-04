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

/**
 * Monday's GraphQL `boards(limit: N, page: P, state: active)` has no cursor:
 * `page` starts at 1 and you stop once a page returns fewer than `limit` items
 * (or an empty page). We request the largest page (`MONDAY_BOARDS_LIMIT`) and
 * bound the drain with `MAX_MONDAY_PAGES`.
 */
const MONDAY_BOARDS_LIMIT = 100
const MAX_MONDAY_PAGES = 50

interface MondayGraphQLError {
  message?: string
}

interface MondayBoard {
  id: string
  name: string
}

interface MondayBoardsResponse {
  errors?: MondayGraphQLError[]
  error_message?: string
  data?: {
    boards?: MondayBoard[]
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

    const allBoards: MondayBoard[] = []
    let page = 1

    for (; page <= MAX_MONDAY_PAGES; page++) {
      const response = await fetch('https://api.monday.com/v2', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: accessToken,
          'API-Version': '2024-10',
        },
        body: JSON.stringify({
          query: `{ boards(limit: ${MONDAY_BOARDS_LIMIT}, page: ${page}, state: active) { id name } }`,
        }),
      })

      if (!response.ok) {
        const details = await response.text().catch(() => '')
        logger.error('Monday.com API HTTP error', {
          status: response.status,
          statusText: response.statusText,
          details,
        })
        return NextResponse.json(
          { error: `Monday.com API error: ${response.status} ${response.statusText}` },
          { status: 500 }
        )
      }

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

      const pageBoards = data.data?.boards || []
      allBoards.push(...pageBoards)

      if (pageBoards.length < MONDAY_BOARDS_LIMIT) {
        break
      }

      if (page === MAX_MONDAY_PAGES) {
        logger.warn(
          'Monday boards pagination hit MAX_MONDAY_PAGES cap; board list may be incomplete',
          {
            maxPages: MAX_MONDAY_PAGES,
          }
        )
      }
    }

    const boards = allBoards.map((board) => ({
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
