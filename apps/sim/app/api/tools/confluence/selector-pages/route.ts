import { createLogger } from '@sim/logger'
import { type NextRequest, NextResponse } from 'next/server'
import { confluenceSelectorPagesContract } from '@/lib/api/contracts/selectors/confluence'
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
import { getConfluenceCloudId } from '@/tools/confluence/utils'

const logger = createLogger('ConfluenceSelectorPagesAPI')

export const dynamic = 'force-dynamic'

interface ConfluencePageRow {
  id: string
  title: string
}

interface ConfluencePagesResponse {
  results?: ConfluencePageRow[]
}

export const POST = withRouteHandler(async (request: NextRequest) => {
  try {
    const authentication = await authenticateSelectorRequest(request)
    if (!authentication.ok) {
      return NextResponse.json({ error: authentication.error }, { status: authentication.status })
    }
    const parsed = await parseRequest(confluenceSelectorPagesContract, request, {})
    if (!parsed.success) return parsed.response

    const { credential, workflowId, domain: domainReference, title, limit } = parsed.data.body
    const resolution = await resolveAuthorizedSelectorContext(authentication.principal, {
      workflowId,
      credentialId: credential,
      context: { domain: domainReference },
    })
    if (!resolution.ok) {
      return NextResponse.json({ error: resolution.error }, { status: resolution.status })
    }

    const credentialOwnerUserId = resolution.credentialAccess?.credentialOwnerUserId
    if (!credentialOwnerUserId) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 403 })
    }
    const bundle = await resolveAtlassianSelectorCredential({
      credentialId: credential,
      credentialOwnerUserId,
      requestId: generateRequestId(),
      serviceId: 'confluence',
    })
    if (!bundle) {
      return NextResponse.json({ error: 'Could not retrieve access token' }, { status: 401 })
    }

    const domain = resolution.context.domain as string
    const cloudIdResolution = await resolveSelectorProviderValue('Confluence', async () =>
      bundle.cloudId
        ? bundle.cloudId
        : getConfluenceCloudId(domain, bundle.accessToken, SELECTOR_ATLASSIAN_DISCOVERY_OPTIONS)
    )
    if (!cloudIdResolution.ok) {
      logger.warn('Confluence selector discovery failed', {
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

    const search = new URLSearchParams({ limit: String(limit) })
    if (title) search.set('title', title)
    const url = `https://api.atlassian.com/ex/confluence/${cloudIdValidation.sanitized}/wiki/api/v2/pages?${search.toString()}`
    const response = await fetch(url, {
      method: 'GET',
      headers: { Accept: 'application/json', Authorization: `Bearer ${bundle.accessToken}` },
    })
    if (!response.ok) {
      logger.warn('Confluence selector pages request failed', { status: response.status })
      const failure = selectorProviderFailure('Confluence', response.status)
      return NextResponse.json(failure, { status: failure.status })
    }

    const data = (await response.json()) as ConfluencePagesResponse
    return NextResponse.json({
      files: (data.results ?? []).map((page) => ({
        id: page.id,
        name: page.title,
      })),
    })
  } catch {
    logger.error('Error listing Confluence selector pages')
    return NextResponse.json({ error: 'Failed to retrieve Confluence pages' }, { status: 500 })
  }
})
