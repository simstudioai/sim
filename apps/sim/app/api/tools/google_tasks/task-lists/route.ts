import { createLogger } from '@sim/logger'
import { type NextRequest, NextResponse } from 'next/server'
import { googleTasksTaskListsSelectorContract } from '@/lib/api/contracts/selectors/google'
import { parseRequest } from '@/lib/api/server'
import { authorizeCredentialUse } from '@/lib/auth/credential-access'
import { generateRequestId } from '@/lib/core/utils/request'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'
import { drainGooglePagedList, GooglePageError } from '@/lib/oauth/google-pagination'
import { getScopesForService } from '@/lib/oauth/utils'
import { refreshAccessTokenIfNeeded, ServiceAccountTokenError } from '@/app/api/auth/oauth/utils'

const logger = createLogger('GoogleTasksTaskListsAPI')

export const dynamic = 'force-dynamic'

const MAX_TASK_LIST_PAGES = 20
const TASK_LIST_PAGE_SIZE = 1000

interface GoogleTaskList {
  id: string
  title: string
}

interface GoogleTaskListsResponse {
  items?: GoogleTaskList[]
  nextPageToken?: string
}

export const POST = withRouteHandler(async (request: NextRequest) => {
  const requestId = generateRequestId()
  try {
    const parsed = await parseRequest(
      googleTasksTaskListsSelectorContract,
      request,
      {},
      {
        validationErrorResponse: () => {
          logger.error('Missing credential in request')
          return NextResponse.json({ error: 'Credential is required' }, { status: 400 })
        },
      }
    )
    if (!parsed.success) return parsed.response

    const { credential, workflowId, impersonateEmail } = parsed.data.body

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

    const { items } = await drainGooglePagedList<GoogleTaskList, GoogleTaskListsResponse>({
      buildUrl: (pageToken) => {
        const url = new URL('https://tasks.googleapis.com/tasks/v1/users/@me/lists')
        url.searchParams.set('maxResults', String(TASK_LIST_PAGE_SIZE))
        if (pageToken) url.searchParams.set('pageToken', pageToken)
        return url.toString()
      },
      fetch: (url) =>
        fetch(url, {
          headers: {
            Authorization: `Bearer ${accessToken}`,
            'Content-Type': 'application/json',
          },
        }),
      parseError: (response) => response.json().catch(() => ({})),
      getItems: (body) => body.items,
      getNextPageToken: (body) => body.nextPageToken,
      maxPages: MAX_TASK_LIST_PAGES,
      label: 'Google Tasks task lists',
    })

    const taskLists = items.map((list) => ({
      id: list.id,
      title: list.title,
    }))

    return NextResponse.json({ taskLists })
  } catch (error) {
    if (error instanceof GooglePageError) {
      logger.error('Failed to fetch Google Tasks task lists', {
        status: error.status,
        error: error.body,
      })
      return NextResponse.json(
        { error: 'Failed to fetch Google Tasks task lists', details: error.body },
        { status: error.status }
      )
    }
    if (error instanceof ServiceAccountTokenError) {
      return NextResponse.json({ error: error.message }, { status: 400 })
    }
    logger.error('Error processing Google Tasks task lists request:', error)
    return NextResponse.json(
      { error: 'Failed to retrieve Google Tasks task lists', details: (error as Error).message },
      { status: 500 }
    )
  }
})
