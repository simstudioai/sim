import { createLogger } from '@sim/logger'
import { type NextRequest, NextResponse } from 'next/server'
import { jsmServiceDesksSelectorContract } from '@/lib/api/contracts/selectors/jsm'
import { parseRequest } from '@/lib/api/server'
import { authorizeCredentialUse } from '@/lib/auth/credential-access'
import { validateJiraCloudId } from '@/lib/core/security/input-validation'
import { generateRequestId } from '@/lib/core/utils/request'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'
import { refreshAccessTokenIfNeeded } from '@/app/api/auth/oauth/utils'
import { getJiraCloudId, parseAtlassianErrorMessage } from '@/tools/jira/utils'
import { getJsmApiBaseUrl, getJsmHeaders } from '@/tools/jsm/utils'

const logger = createLogger('JsmSelectorServiceDesksAPI')

export const dynamic = 'force-dynamic'

const JSM_SERVICE_DESKS_PAGE_SIZE = 100
const MAX_JSM_SERVICE_DESKS_PAGES = 50

interface JsmPagedResponse<T> {
  values?: T[]
  isLastPage?: boolean
  _links?: { next?: string }
}

interface JsmServiceDeskValue {
  id: string
  projectName: string
}

/**
 * Drains the offset-paginated JSM `/servicedesk` endpoint, advancing `start` by
 * the number of rows actually returned until `isLastPage === true` (or
 * `_links.next` is absent, or a page comes back empty). Advancing by the real
 * row count — not the requested `limit` — prevents skipping items if the server
 * returns a short non-final page. Bounded by `MAX_JSM_SERVICE_DESKS_PAGES`;
 * emits a `logger.warn` and returns the partial set rather than looping
 * unbounded when the cap is hit.
 */
async function fetchAllJsmServiceDesks(
  baseUrl: string,
  accessToken: string
): Promise<{ values: JsmServiceDeskValue[]; lastResponse: Response }> {
  const values: JsmServiceDeskValue[] = []
  let start = 0
  let lastResponse: Response

  for (let page = 0; page < MAX_JSM_SERVICE_DESKS_PAGES; page++) {
    const url = `${baseUrl}/servicedesk?start=${start}&limit=${JSM_SERVICE_DESKS_PAGE_SIZE}`

    const response = await fetch(url, {
      method: 'GET',
      headers: getJsmHeaders(accessToken),
    })

    if (!response.ok) {
      return { values, lastResponse: response }
    }

    const data = (await response.json()) as JsmPagedResponse<JsmServiceDeskValue>
    lastResponse = response

    const pageValues = data.values ?? []
    values.push(...pageValues)

    if (data.isLastPage === true || !data._links?.next || pageValues.length === 0) {
      return { values, lastResponse }
    }

    start += pageValues.length

    if (page === MAX_JSM_SERVICE_DESKS_PAGES - 1) {
      logger.warn('JSM service desk list hit pagination cap; list may be incomplete', {
        pages: MAX_JSM_SERVICE_DESKS_PAGES,
        collected: values.length,
      })
    }
  }

  return { values, lastResponse: lastResponse! }
}

export const POST = withRouteHandler(async (request: NextRequest) => {
  const requestId = generateRequestId()
  try {
    const parsed = await parseRequest(jsmServiceDesksSelectorContract, request, {})
    if (!parsed.success) return parsed.response

    const { credential, workflowId, domain } = parsed.data.body

    if (!credential) {
      logger.error('Missing credential in request')
      return NextResponse.json({ error: 'Credential is required' }, { status: 400 })
    }

    if (!domain) {
      return NextResponse.json({ error: 'Domain is required' }, { status: 400 })
    }

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

    const cloudId = await getJiraCloudId(domain, accessToken)

    const cloudIdValidation = validateJiraCloudId(cloudId, 'cloudId')
    if (!cloudIdValidation.isValid) {
      return NextResponse.json({ error: cloudIdValidation.error }, { status: 400 })
    }

    const baseUrl = getJsmApiBaseUrl(cloudIdValidation.sanitized!)

    const { values, lastResponse } = await fetchAllJsmServiceDesks(baseUrl, accessToken)

    if (!lastResponse.ok) {
      const errorText = await lastResponse.text()
      logger.error('JSM API error:', {
        status: lastResponse.status,
        statusText: lastResponse.statusText,
        error: errorText,
      })
      return NextResponse.json(
        {
          error: parseAtlassianErrorMessage(
            lastResponse.status,
            lastResponse.statusText,
            errorText
          ),
        },
        { status: lastResponse.status }
      )
    }

    const serviceDesks = values.map((sd) => ({
      id: sd.id,
      name: sd.projectName,
    }))

    return NextResponse.json({ serviceDesks })
  } catch (error) {
    logger.error('Error listing JSM service desks:', error)
    return NextResponse.json(
      { error: (error as Error).message || 'Internal server error' },
      { status: 500 }
    )
  }
})
