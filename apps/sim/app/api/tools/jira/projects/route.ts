import { createLogger } from '@sim/logger'
import { type NextRequest, NextResponse } from 'next/server'
import {
  jiraProjectSelectorContract,
  jiraProjectsSelectorContract,
} from '@/lib/api/contracts/selectors/jira'
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

export const dynamic = 'force-dynamic'

const logger = createLogger('JiraProjectsAPI')

const JIRA_PROJECTS_PAGE_SIZE = 50
const MAX_JIRA_PROJECTS_PAGES = 40

interface JiraProjectSearchPage {
  values?: unknown[]
  isLast?: boolean
  maxResults?: number
}

/**
 * Drains the offset-paginated Jira `/project/search` endpoint, advancing
 * `startAt` by the server-returned page size until `isLast === true` (or a short
 * page is seen). Bounded by `MAX_JIRA_PROJECTS_PAGES`; emits a `logger.warn` and
 * returns the partial set rather than looping unbounded when the cap is hit.
 */
async function fetchAllJiraProjects(
  apiUrl: string,
  baseParams: URLSearchParams,
  accessToken: string
): Promise<{ values: unknown[]; lastResponse: Response }> {
  const values: unknown[] = []
  let startAt = 0
  let lastResponse: Response

  for (let page = 0; page < MAX_JIRA_PROJECTS_PAGES; page++) {
    const params = new URLSearchParams(baseParams)
    params.set('startAt', String(startAt))
    params.set('maxResults', String(JIRA_PROJECTS_PAGE_SIZE))

    const finalUrl = `${apiUrl}?${params.toString()}`
    logger.info(`Fetching Jira projects from: ${finalUrl}`)

    const response = await fetch(finalUrl, {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        Accept: 'application/json',
      },
    })

    logger.info(`Response status: ${response.status} ${response.statusText}`)

    if (!response.ok) {
      return { values, lastResponse: response }
    }

    const data = (await response.json()) as JiraProjectSearchPage
    lastResponse = response

    const pageValues = data.values ?? []
    values.push(...pageValues)

    const pageSize =
      data.maxResults && data.maxResults > 0 ? data.maxResults : JIRA_PROJECTS_PAGE_SIZE
    if (data.isLast === true || pageValues.length < pageSize) {
      return { values, lastResponse }
    }

    startAt += pageValues.length

    if (page === MAX_JIRA_PROJECTS_PAGES - 1) {
      logger.warn('Jira project search hit pagination cap; project list may be incomplete', {
        pages: MAX_JIRA_PROJECTS_PAGES,
        collected: values.length,
      })
    }
  }

  return { values, lastResponse: lastResponse! }
}

export const GET = withRouteHandler(async (request: NextRequest) => {
  try {
    const authentication = await authenticateSelectorRequest(request)
    if (!authentication.ok) {
      return NextResponse.json({ error: authentication.error }, { status: authentication.status })
    }
    const parsed = await parseRequest(jiraProjectsSelectorContract, request, {})
    if (!parsed.success) return parsed.response

    const { credential, workflowId, domain: domainReference, query = '' } = parsed.data.query
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
      requestId: generateRequestId(),
      serviceId: 'jira',
    })
    if (!bundle) {
      return NextResponse.json({ error: 'Could not retrieve access token' }, { status: 401 })
    }
    const domain = resolution.context.domain as string
    const accessToken = bundle.accessToken
    const cloudIdResolution = await resolveSelectorProviderValue('Jira', async () =>
      bundle.cloudId
        ? bundle.cloudId
        : getJiraCloudId(domain, accessToken, SELECTOR_ATLASSIAN_DISCOVERY_OPTIONS)
    )
    if (!cloudIdResolution.ok) {
      logger.warn('Jira selector discovery failed', {
        status: cloudIdResolution.upstreamStatus ?? 'unknown',
      })
      return NextResponse.json(cloudIdResolution.failure, {
        status: cloudIdResolution.failure.status,
      })
    }
    const cloudId = cloudIdResolution.value
    logger.info(`Using cloud ID: ${cloudId}`)

    const cloudIdValidation = validateJiraCloudId(cloudId, 'cloudId')
    if (!cloudIdValidation.isValid) {
      return NextResponse.json({ error: cloudIdValidation.error }, { status: 400 })
    }

    const apiUrl = `https://api.atlassian.com/ex/jira/${cloudId}/rest/api/3/project/search`

    const queryParams = new URLSearchParams()
    if (query) {
      queryParams.append('query', query)
    }
    queryParams.append('orderBy', 'name')
    queryParams.append('expand', 'description,lead,url,projectKeys')

    const { values, lastResponse } = await fetchAllJiraProjects(apiUrl, queryParams, accessToken)

    if (!lastResponse.ok) {
      logger.warn('Jira selector project request failed', { status: lastResponse.status })
      const failure = selectorProviderFailure('Jira', lastResponse.status)
      return NextResponse.json(failure, { status: failure.status })
    }

    logger.info(`Jira API Response Status: ${lastResponse.status}`)
    logger.info(`Found projects: ${values.length}`)

    const projects =
      values.map((project: any) => ({
        id: project.id,
        name: project.name,
      })) || []

    return NextResponse.json({ projects })
  } catch {
    logger.error('Error fetching Jira projects')
    return NextResponse.json({ error: 'Failed to retrieve Jira projects' }, { status: 500 })
  }
})

export const POST = withRouteHandler(async (request: NextRequest) => {
  try {
    const authentication = await authenticateSelectorRequest(request)
    if (!authentication.ok) {
      return NextResponse.json({ error: authentication.error }, { status: authentication.status })
    }
    const parsed = await parseRequest(jiraProjectSelectorContract, request, {})
    if (!parsed.success) return parsed.response

    const { credential, workflowId, domain: domainReference, projectId } = parsed.data.body

    if (!projectId) {
      return NextResponse.json({ error: 'Project ID is required' }, { status: 400 })
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
      requestId: generateRequestId(),
      serviceId: 'jira',
    })
    if (!bundle) {
      return NextResponse.json({ error: 'Could not retrieve access token' }, { status: 401 })
    }
    const domain = resolution.context.domain as string
    const accessToken = bundle.accessToken
    const cloudIdResolution = await resolveSelectorProviderValue('Jira', async () =>
      bundle.cloudId
        ? bundle.cloudId
        : getJiraCloudId(domain, accessToken, SELECTOR_ATLASSIAN_DISCOVERY_OPTIONS)
    )
    if (!cloudIdResolution.ok) {
      logger.warn('Jira selector discovery failed', {
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

    const projectIdValidation = validateAlphanumericId(projectId, 'projectId', 100)
    if (!projectIdValidation.isValid) {
      return NextResponse.json({ error: projectIdValidation.error }, { status: 400 })
    }

    const apiUrl = `https://api.atlassian.com/ex/jira/${cloudId}/rest/api/3/project/${projectId}`

    const response = await fetch(apiUrl, {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        Accept: 'application/json',
      },
    })

    if (!response.ok) {
      logger.warn('Jira selector project detail request failed', { status: response.status })
      const failure = selectorProviderFailure('Jira', response.status)
      return NextResponse.json(failure, { status: failure.status })
    }

    const project = await response.json()

    return NextResponse.json({
      project: {
        id: project.id,
        name: project.name,
      },
    })
  } catch {
    logger.error('Error fetching Jira project')
    return NextResponse.json({ error: 'Failed to retrieve Jira project' }, { status: 500 })
  }
})
