import { createLogger } from '@sim/logger'
import { type NextRequest, NextResponse } from 'next/server'
import { pipedrivePipelinesSelectorContract } from '@/lib/api/contracts/selectors'
import { parseRequest } from '@/lib/api/server'
import { authorizeCredentialUse } from '@/lib/auth/credential-access'
import { generateRequestId } from '@/lib/core/utils/request'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'
import { refreshAccessTokenIfNeeded } from '@/app/api/auth/oauth/utils'

const logger = createLogger('PipedrivePipelinesAPI')

export const dynamic = 'force-dynamic'

const PIPEDRIVE_PAGE_LIMIT = 500
const PIPEDRIVE_MAX_PIPELINES_PAGES = 50

interface PipedrivePipeline {
  id: number
  name: string
}

interface PipedrivePipelinesPage {
  data?: PipedrivePipeline[]
  additional_data?: {
    pagination?: {
      more_items_in_collection?: boolean
      next_start?: number
    }
  }
}

/**
 * Lists all Pipedrive pipelines using v1 offset pagination (`start`/`limit`),
 * following `additional_data.pagination.next_start` while
 * `more_items_in_collection` is true so the full set is returned. Bounded by
 * `PIPEDRIVE_MAX_PIPELINES_PAGES`; logs a warning rather than silently dropping
 * pipelines when the cap is hit.
 */
async function fetchAllPipelines(accessToken: string): Promise<PipedrivePipeline[]> {
  const pipelines: PipedrivePipeline[] = []
  let start = 0

  for (let page = 0; page < PIPEDRIVE_MAX_PIPELINES_PAGES; page++) {
    const url = new URL('https://api.pipedrive.com/v1/pipelines')
    url.searchParams.set('start', String(start))
    url.searchParams.set('limit', String(PIPEDRIVE_PAGE_LIMIT))

    const response = await fetch(url.toString(), {
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
    })

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}))
      throw new PipedriveFetchError(response.status, errorData)
    }

    const data = (await response.json()) as PipedrivePipelinesPage
    if (Array.isArray(data.data)) {
      pipelines.push(...data.data)
    }

    const pagination = data.additional_data?.pagination
    if (!pagination?.more_items_in_collection || typeof pagination.next_start !== 'number') {
      return pipelines
    }
    start = pagination.next_start

    if (page === PIPEDRIVE_MAX_PIPELINES_PAGES - 1) {
      logger.warn(
        'Pipedrive pipelines listing hit pagination cap; pipeline list may be incomplete',
        {
          pages: PIPEDRIVE_MAX_PIPELINES_PAGES,
        }
      )
    }
  }

  return pipelines
}

class PipedriveFetchError extends Error {
  constructor(
    readonly status: number,
    readonly details: unknown
  ) {
    super('Failed to fetch Pipedrive pipelines')
    this.name = 'PipedriveFetchError'
  }
}

export const POST = withRouteHandler(async (request: NextRequest) => {
  const requestId = generateRequestId()
  try {
    const parsed = await parseRequest(pipedrivePipelinesSelectorContract, request, {})
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

    let allPipelines: PipedrivePipeline[]
    try {
      allPipelines = await fetchAllPipelines(accessToken)
    } catch (error) {
      if (error instanceof PipedriveFetchError) {
        logger.error('Failed to fetch Pipedrive pipelines', {
          status: error.status,
          error: error.details,
        })
        return NextResponse.json(
          { error: 'Failed to fetch Pipedrive pipelines', details: error.details },
          { status: error.status }
        )
      }
      throw error
    }

    const pipelines = allPipelines.map((pipeline) => ({
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
})
