import { createLogger } from '@sim/logger'
import { type NextRequest, NextResponse } from 'next/server'
import {
  jiraProjectSelectorContract,
  jiraProjectsSelectorContract,
} from '@/lib/api/contracts/selectors/jira'
import { parseRequest } from '@/lib/api/server'
import { checkSessionOrInternalAuth } from '@/lib/auth/hybrid'
import { validateAlphanumericId, validateJiraCloudId } from '@/lib/core/security/input-validation'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'
import { getJiraCloudId, parseAtlassianErrorMessage } from '@/tools/jira/utils'

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
    const auth = await checkSessionOrInternalAuth(request)
    if (!auth.success || !auth.userId) {
      return NextResponse.json({ error: auth.error || 'Unauthorized' }, { status: 401 })
    }

    const parsed = await parseRequest(jiraProjectsSelectorContract, request, {})
    if (!parsed.success) return parsed.response

    const { domain, accessToken, cloudId: providedCloudId, query = '' } = parsed.data.query

    if (!domain) {
      return NextResponse.json({ error: 'Domain is required' }, { status: 400 })
    }

    if (!accessToken) {
      return NextResponse.json({ error: 'Access token is required' }, { status: 400 })
    }

    const cloudId = providedCloudId || (await getJiraCloudId(domain, accessToken))
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
      const errorText = await lastResponse.text()
      logger.error('Jira API error:', { status: lastResponse.status, error: errorText })
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

    logger.info(`Jira API Response Status: ${lastResponse.status}`)
    logger.info(`Found projects: ${values.length}`)

    const projects =
      values.map((project: any) => ({
        id: project.id,
        key: project.key,
        name: project.name,
        url: project.self,
        avatarUrl: project.avatarUrls?.['48x48'],
        description: project.description,
        projectTypeKey: project.projectTypeKey,
        simplified: project.simplified,
        style: project.style,
        isPrivate: project.isPrivate,
      })) || []

    return NextResponse.json({
      projects,
      cloudId,
    })
  } catch (error) {
    logger.error('Error fetching Jira projects:', error)
    return NextResponse.json(
      { error: (error as Error).message || 'Internal server error' },
      { status: 500 }
    )
  }
})

export const POST = withRouteHandler(async (request: NextRequest) => {
  try {
    const auth = await checkSessionOrInternalAuth(request)
    if (!auth.success || !auth.userId) {
      return NextResponse.json({ error: auth.error || 'Unauthorized' }, { status: 401 })
    }

    const parsed = await parseRequest(jiraProjectSelectorContract, request, {})
    if (!parsed.success) return parsed.response

    const { domain, accessToken, projectId, cloudId: providedCloudId } = parsed.data.body

    if (!domain) {
      return NextResponse.json({ error: 'Domain is required' }, { status: 400 })
    }

    if (!accessToken) {
      return NextResponse.json({ error: 'Access token is required' }, { status: 400 })
    }

    if (!projectId) {
      return NextResponse.json({ error: 'Project ID is required' }, { status: 400 })
    }

    const cloudId = providedCloudId || (await getJiraCloudId(domain, accessToken))

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
      const errorText = await response.text()
      logger.error('Jira API error:', { status: response.status, error: errorText })
      return NextResponse.json(
        { error: parseAtlassianErrorMessage(response.status, response.statusText, errorText) },
        { status: response.status }
      )
    }

    const project = await response.json()

    return NextResponse.json({
      project: {
        id: project.id,
        key: project.key,
        name: project.name,
        url: project.self,
        avatarUrl: project.avatarUrls?.['48x48'],
        description: project.description,
        projectTypeKey: project.projectTypeKey,
        simplified: project.simplified,
        style: project.style,
        isPrivate: project.isPrivate,
      },
      cloudId,
    })
  } catch (error) {
    logger.error('Error fetching Jira project:', error)
    return NextResponse.json(
      { error: (error as Error).message || 'Internal server error' },
      { status: 500 }
    )
  }
})
