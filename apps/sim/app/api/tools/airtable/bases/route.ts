import { createLogger } from '@sim/logger'
import { type NextRequest, NextResponse } from 'next/server'
import { airtableBasesSelectorContract } from '@/lib/api/contracts/selectors'
import { parseRequest } from '@/lib/api/server'
import { authorizeCredentialUse } from '@/lib/auth/credential-access'
import { generateRequestId } from '@/lib/core/utils/request'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'
import { refreshAccessTokenIfNeeded } from '@/app/api/auth/oauth/utils'

const logger = createLogger('AirtableBasesAPI')

export const dynamic = 'force-dynamic'

const AIRTABLE_MAX_BASES_PAGES = 50

interface AirtableBase {
  id: string
  name: string
}

/**
 * Lists all Airtable bases, following the `offset` continuation token the Meta
 * API returns (an opaque string, passed back verbatim as `?offset=`) so the
 * full set is returned. Bounded by `AIRTABLE_MAX_BASES_PAGES`; logs a warning
 * rather than silently dropping bases when the cap is hit.
 */
async function fetchAllBases(accessToken: string): Promise<AirtableBase[]> {
  const bases: AirtableBase[] = []
  let offset: string | undefined

  for (let page = 0; page < AIRTABLE_MAX_BASES_PAGES; page++) {
    const url = new URL('https://api.airtable.com/v0/meta/bases')
    if (offset) {
      url.searchParams.set('offset', offset)
    }

    const response = await fetch(url.toString(), {
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
    })

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}))
      throw new AirtableFetchError(response.status, errorData)
    }

    const data = (await response.json()) as { bases?: AirtableBase[]; offset?: string }
    if (Array.isArray(data.bases)) {
      bases.push(...data.bases)
    }

    offset = data.offset || undefined
    if (!offset) {
      return bases
    }

    if (page === AIRTABLE_MAX_BASES_PAGES - 1) {
      logger.warn('Airtable bases listing hit pagination cap; base list may be incomplete', {
        pages: AIRTABLE_MAX_BASES_PAGES,
      })
    }
  }

  return bases
}

class AirtableFetchError extends Error {
  constructor(
    readonly status: number,
    readonly details: unknown
  ) {
    super('Failed to fetch Airtable bases')
    this.name = 'AirtableFetchError'
  }
}

export const POST = withRouteHandler(async (request: NextRequest) => {
  const requestId = generateRequestId()
  try {
    const parsed = await parseRequest(airtableBasesSelectorContract, request, {})
    if (!parsed.success) {
      logger.error('Missing credential in request')
      return parsed.response
    }
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

    let allBases: AirtableBase[]
    try {
      allBases = await fetchAllBases(accessToken)
    } catch (error) {
      if (error instanceof AirtableFetchError) {
        logger.error('Failed to fetch Airtable bases', {
          status: error.status,
          error: error.details,
        })
        return NextResponse.json(
          { error: 'Failed to fetch Airtable bases', details: error.details },
          { status: error.status }
        )
      }
      throw error
    }

    const bases = allBases.map((base) => ({
      id: base.id,
      name: base.name,
    }))

    return NextResponse.json({ bases })
  } catch (error) {
    logger.error('Error processing Airtable bases request:', error)
    return NextResponse.json(
      { error: 'Failed to retrieve Airtable bases', details: (error as Error).message },
      { status: 500 }
    )
  }
})
