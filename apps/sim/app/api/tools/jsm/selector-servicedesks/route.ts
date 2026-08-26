import { createLogger } from '@sim/logger'
import { type NextRequest, NextResponse } from 'next/server'
import { jsmServiceDesksSelectorContract } from '@/lib/api/contracts/selectors/jsm'
import { parseRequest } from '@/lib/api/server'
import { validateJiraCloudId } from '@/lib/core/security/input-validation'
import { generateRequestId } from '@/lib/core/utils/request'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'
import { resolveAtlassianSelectorCredential } from '@/lib/selectors/application/atlassian-credential'
import {
  resolveSelectorProviderValue,
  SELECTOR_ATLASSIAN_DISCOVERY_OPTIONS,
  selectorProviderFailure,
} from '@/lib/selectors/server/provider-errors'
import {
  authenticateSelectorRequest,
  resolveAuthorizedSelectorContext,
} from '@/lib/selectors/server/resolve-authorized-context'
import { getJiraCloudId } from '@/tools/jira/utils'
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
    const authentication = await authenticateSelectorRequest(request)
    if (!authentication.ok) {
      return NextResponse.json({ error: authentication.error }, { status: authentication.status })
    }
    const parsed = await parseRequest(jsmServiceDesksSelectorContract, request, {})
    if (!parsed.success) return parsed.response

    const { credential, workflowId, domain: domainReference } = parsed.data.body

    if (!credential) {
      logger.error('Missing credential in request')
      return NextResponse.json({ error: 'Credential is required' }, { status: 400 })
    }

    const resolution = await resolveAuthorizedSelectorContext(authentication.principal, {
      workflowId,
      credentialId: credential,
      context: { domain: domainReference },
    })
    if (!resolution.ok) {
      return NextResponse.json({ error: resolution.error }, { status: resolution.status })
    }
    const ownerUserId = resolution.credentialAccess?.credentialOwnerUserId
    if (!ownerUserId) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 403 })
    }
    const bundle = await resolveAtlassianSelectorCredential({
      credentialId: credential,
      credentialOwnerUserId: ownerUserId,
      requestId,
      serviceId: 'jira',
    })
    if (!bundle) {
      logger.error('Failed to get JSM selector access token')
      return NextResponse.json(
        { error: 'Could not retrieve access token', authRequired: true },
        { status: 401 }
      )
    }

    const domain = resolution.context.domain as string
    const accessToken = bundle.accessToken
    const cloudIdResolution = await resolveSelectorProviderValue(
      'Jira Service Management',
      async () =>
        bundle.cloudId
          ? bundle.cloudId
          : getJiraCloudId(domain, accessToken, SELECTOR_ATLASSIAN_DISCOVERY_OPTIONS)
    )
    if (!cloudIdResolution.ok) {
      logger.warn('JSM selector discovery failed', {
        status: cloudIdResolution.upstreamStatus ?? 'unknown',
      })
      return NextResponse.json(cloudIdResolution.failure, {
        status: cloudIdResolution.failure.status,
      })
    }
    const cloudId = cloudIdResolution.value

    const cloudIdValidation = validateJiraCloudId(cloudId, 'cloudId')
    if (!cloudIdValidation.isValid) {
      return NextResponse.json({ error: cloudIdValidation.error }, { status: 400 })
    }

    const baseUrl = getJsmApiBaseUrl(cloudIdValidation.sanitized!)

    const { values, lastResponse } = await fetchAllJsmServiceDesks(baseUrl, accessToken)

    if (!lastResponse.ok) {
      logger.warn('JSM selector service-desk request failed', { status: lastResponse.status })
      const failure = selectorProviderFailure('Jira Service Management', lastResponse.status)
      return NextResponse.json(failure, { status: failure.status })
    }

    const serviceDesks = values.map((sd) => ({
      id: sd.id,
      name: sd.projectName,
    }))

    return NextResponse.json({ serviceDesks })
  } catch {
    logger.error('Error listing JSM service desks')
    return NextResponse.json({ error: 'Failed to retrieve JSM service desks' }, { status: 500 })
  }
})
