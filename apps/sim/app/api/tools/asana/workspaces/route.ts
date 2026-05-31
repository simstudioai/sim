import { createLogger } from '@sim/logger'
import { type NextRequest, NextResponse } from 'next/server'
import { asanaWorkspacesSelectorContract } from '@/lib/api/contracts/selectors'
import { parseRequest } from '@/lib/api/server'
import { authorizeCredentialUse } from '@/lib/auth/credential-access'
import { generateRequestId } from '@/lib/core/utils/request'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'
import { refreshAccessTokenIfNeeded } from '@/app/api/auth/oauth/utils'

const logger = createLogger('AsanaWorkspacesAPI')

export const dynamic = 'force-dynamic'

const ASANA_PAGE_LIMIT = 100
const ASANA_MAX_WORKSPACES_PAGES = 50

interface AsanaWorkspace {
  gid: string
  name: string
}

interface AsanaWorkspacesPage {
  data?: AsanaWorkspace[]
  next_page?: {
    offset?: string
  } | null
}

/**
 * Lists all Asana workspaces using `limit`/`offset` pagination, following
 * `next_page.offset` (an opaque token, passed back verbatim as `?offset=`)
 * until `next_page` is null so the full set is returned. Bounded by
 * `ASANA_MAX_WORKSPACES_PAGES`; logs a warning rather than silently dropping
 * workspaces when the cap is hit.
 */
async function fetchAllWorkspaces(accessToken: string): Promise<AsanaWorkspace[]> {
  const workspaces: AsanaWorkspace[] = []
  let offset: string | undefined

  for (let page = 0; page < ASANA_MAX_WORKSPACES_PAGES; page++) {
    const url = new URL('https://app.asana.com/api/1.0/workspaces')
    url.searchParams.set('limit', String(ASANA_PAGE_LIMIT))
    if (offset) {
      url.searchParams.set('offset', offset)
    }

    const response = await fetch(url.toString(), {
      headers: {
        Authorization: `Bearer ${accessToken}`,
        Accept: 'application/json',
      },
    })

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}))
      throw new AsanaFetchError(response.status, errorData)
    }

    const data = (await response.json()) as AsanaWorkspacesPage
    if (Array.isArray(data.data)) {
      workspaces.push(...data.data)
    }

    offset = data.next_page?.offset || undefined
    if (!offset) {
      return workspaces
    }

    if (page === ASANA_MAX_WORKSPACES_PAGES - 1) {
      logger.warn('Asana workspaces listing hit pagination cap; workspace list may be incomplete', {
        pages: ASANA_MAX_WORKSPACES_PAGES,
      })
    }
  }

  return workspaces
}

class AsanaFetchError extends Error {
  constructor(
    readonly status: number,
    readonly details: unknown
  ) {
    super('Failed to fetch Asana workspaces')
    this.name = 'AsanaFetchError'
  }
}

export const POST = withRouteHandler(async (request: NextRequest) => {
  const requestId = generateRequestId()
  try {
    const parsed = await parseRequest(asanaWorkspacesSelectorContract, request, {})
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

    let allWorkspaces: AsanaWorkspace[]
    try {
      allWorkspaces = await fetchAllWorkspaces(accessToken)
    } catch (error) {
      if (error instanceof AsanaFetchError) {
        logger.error('Failed to fetch Asana workspaces', {
          status: error.status,
          error: error.details,
        })
        return NextResponse.json(
          { error: 'Failed to fetch Asana workspaces', details: error.details },
          { status: error.status }
        )
      }
      throw error
    }

    const workspaces = allWorkspaces.map((workspace) => ({
      id: workspace.gid,
      name: workspace.name,
    }))

    return NextResponse.json({ workspaces })
  } catch (error) {
    logger.error('Error processing Asana workspaces request:', error)
    return NextResponse.json(
      { error: 'Failed to retrieve Asana workspaces', details: (error as Error).message },
      { status: 500 }
    )
  }
})
