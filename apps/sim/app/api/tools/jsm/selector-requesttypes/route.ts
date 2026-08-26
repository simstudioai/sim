import { createLogger } from '@sim/logger'
import { type NextRequest, NextResponse } from 'next/server'
import { jsmRequestTypesSelectorContract } from '@/lib/api/contracts/selectors/jsm'
import { parseRequest } from '@/lib/api/server'
import { validateAlphanumericId, validateJiraCloudId } from '@/lib/core/security/input-validation'
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

const logger = createLogger('JsmSelectorRequestTypesAPI')

export const dynamic = 'force-dynamic'

const JSM_REQUEST_TYPES_PAGE_SIZE = 100
const MAX_JSM_REQUEST_TYPES_PAGES = 50

interface JsmPagedResponse<T> {
  values?: T[]
  isLastPage?: boolean
  _links?: { next?: string }
}

interface JsmRequestTypeValue {
  id: string
  name: string
}

/**
 * Drains the offset-paginated JSM `/servicedesk/{id}/requesttype` endpoint,
 * advancing `start` by the number of rows actually returned until
 * `isLastPage === true` (or `_links.next` is absent, or a page comes back
 * empty). Advancing by the real row count — not the requested `limit` —
 * prevents skipping items if the server returns a short non-final page. Bounded
 * by `MAX_JSM_REQUEST_TYPES_PAGES`; emits a `logger.warn` and returns the
 * partial set rather than looping unbounded when the cap is hit.
 */
async function fetchAllJsmRequestTypes(
  requestTypeUrl: string,
  accessToken: string
): Promise<{ values: JsmRequestTypeValue[]; lastResponse: Response }> {
  const values: JsmRequestTypeValue[] = []
  let start = 0
  let lastResponse: Response

  for (let page = 0; page < MAX_JSM_REQUEST_TYPES_PAGES; page++) {
    const url = `${requestTypeUrl}?start=${start}&limit=${JSM_REQUEST_TYPES_PAGE_SIZE}`

    const response = await fetch(url, {
      method: 'GET',
      headers: getJsmHeaders(accessToken),
    })

    if (!response.ok) {
      return { values, lastResponse: response }
    }

    const data = (await response.json()) as JsmPagedResponse<JsmRequestTypeValue>
    lastResponse = response

    const pageValues = data.values ?? []
    values.push(...pageValues)

    if (data.isLastPage === true || !data._links?.next || pageValues.length === 0) {
      return { values, lastResponse }
    }

    start += pageValues.length

    if (page === MAX_JSM_REQUEST_TYPES_PAGES - 1) {
      logger.warn('JSM request type list hit pagination cap; list may be incomplete', {
        pages: MAX_JSM_REQUEST_TYPES_PAGES,
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
    const parsed = await parseRequest(jsmRequestTypesSelectorContract, request, {})
    if (!parsed.success) return parsed.response

    const { credential, workflowId, domain: domainReference, serviceDeskId } = parsed.data.body

    if (!credential) {
      logger.error('Missing credential in request')
      return NextResponse.json({ error: 'Credential is required' }, { status: 400 })
    }

    if (!serviceDeskId) {
      return NextResponse.json({ error: 'Service Desk ID is required' }, { status: 400 })
    }

    const serviceDeskIdValidation = validateAlphanumericId(serviceDeskId, 'serviceDeskId')
    if (!serviceDeskIdValidation.isValid) {
      return NextResponse.json({ error: serviceDeskIdValidation.error }, { status: 400 })
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
    const requestTypeUrl = `${baseUrl}/servicedesk/${serviceDeskIdValidation.sanitized}/requesttype`

    const { values, lastResponse } = await fetchAllJsmRequestTypes(requestTypeUrl, accessToken)

    if (!lastResponse.ok) {
      logger.warn('JSM selector request-type request failed', { status: lastResponse.status })
      const failure = selectorProviderFailure('Jira Service Management', lastResponse.status)
      return NextResponse.json(failure, { status: failure.status })
    }

    const requestTypes = values.map((rt) => ({
      id: rt.id,
      name: rt.name,
    }))

    return NextResponse.json({ requestTypes })
  } catch {
    logger.error('Error listing JSM request types')
    return NextResponse.json({ error: 'Failed to retrieve JSM request types' }, { status: 500 })
  }
})
