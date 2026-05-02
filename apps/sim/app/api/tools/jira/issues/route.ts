import { createLogger } from '@sim/logger'
import { type NextRequest, NextResponse } from 'next/server'
import {
  jiraIssueSelectorContract,
  jiraIssuesSelectorContract,
} from '@/lib/api/contracts/selectors/jira'
import { parseRequest } from '@/lib/api/server'
import { checkSessionOrInternalAuth } from '@/lib/auth/hybrid'
import { validateAlphanumericId, validateJiraCloudId } from '@/lib/core/security/input-validation'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'
import { getJiraCloudId, parseAtlassianErrorMessage } from '@/tools/jira/utils'

export const dynamic = 'force-dynamic'

const logger = createLogger('JiraIssuesAPI')

const createErrorResponse = async (response: Response) => {
  const errorText = await response.text().catch(() => '')
  return parseAtlassianErrorMessage(response.status, response.statusText, errorText)
}

export const POST = withRouteHandler(async (request: NextRequest) => {
  try {
    const auth = await checkSessionOrInternalAuth(request)
    if (!auth.success || !auth.userId) {
      return NextResponse.json({ error: auth.error || 'Unauthorized' }, { status: 401 })
    }

    const parsed = await parseRequest(jiraIssueSelectorContract, request, {})
    if (!parsed.success) return parsed.response

    const { domain, accessToken, issueKeys, cloudId: providedCloudId } = parsed.data.body

    if (issueKeys.length === 0) {
      logger.info('No issue keys provided, returning empty result')
      return NextResponse.json({ issues: [] })
    }

    const ISSUE_KEY_RE = /^[A-Za-z][A-Za-z0-9_]*-\d+$/
    const sanitizedKeys: string[] = []
    for (const k of issueKeys) {
      if (typeof k !== 'string') continue
      const trimmed = k.trim()
      if (!ISSUE_KEY_RE.test(trimmed)) {
        return NextResponse.json({ error: `Invalid Jira issue key: "${trimmed}"` }, { status: 400 })
      }
      sanitizedKeys.push(trimmed)
    }
    if (sanitizedKeys.length === 0) {
      return NextResponse.json({ issues: [] })
    }

    const cloudId = providedCloudId || (await getJiraCloudId(domain, accessToken))

    const cloudIdValidation = validateJiraCloudId(cloudId, 'cloudId')
    if (!cloudIdValidation.isValid) {
      return NextResponse.json({ error: cloudIdValidation.error }, { status: 400 })
    }

    // Use search/jql endpoint (GET) with URL parameters
    const jql = `issueKey in (${sanitizedKeys.join(',')})`
    const params = new URLSearchParams({
      jql,
      fields: 'summary,status,assignee,updated,project',
      maxResults: String(Math.min(sanitizedKeys.length, 100)),
    })
    const searchUrl = `https://api.atlassian.com/ex/jira/${cloudId}/rest/api/3/search/jql?${params.toString()}`

    const response = await fetch(searchUrl, {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        Accept: 'application/json',
      },
    })

    if (!response.ok) {
      logger.error(`Jira API error: ${response.status} ${response.statusText}`)
      const errorMessage = await createErrorResponse(response)
      if (response.status === 401 || response.status === 403) {
        return NextResponse.json(
          {
            error: errorMessage,
            authRequired: true,
            requiredScopes: ['read:jira-work'],
          },
          { status: response.status }
        )
      }
      return NextResponse.json({ error: errorMessage }, { status: response.status })
    }

    const data = await response.json()
    const issues = (data.issues || []).map((it: any) => ({
      id: it.key,
      name: it.fields?.summary || it.key,
      mimeType: 'jira/issue',
      url: `https://${domain}/browse/${it.key}`,
      modifiedTime: it.fields?.updated,
      webViewLink: `https://${domain}/browse/${it.key}`,
    }))

    return NextResponse.json({ issues, cloudId })
  } catch (error) {
    logger.error('Error fetching Jira issues:', error)
    return NextResponse.json(
      { error: (error as Error).message || 'Internal server error' },
      { status: 500 }
    )
  }
})

export const GET = withRouteHandler(async (request: NextRequest) => {
  try {
    const auth = await checkSessionOrInternalAuth(request)
    if (!auth.success || !auth.userId) {
      return NextResponse.json({ error: auth.error || 'Unauthorized' }, { status: 401 })
    }

    const parsed = await parseRequest(jiraIssuesSelectorContract, request, {})
    if (!parsed.success) return parsed.response

    const {
      domain,
      accessToken,
      cloudId: providedCloudId,
      query = '',
      projectId = '',
      manualProjectId = '',
      all,
      limit,
    } = parsed.data.query

    const cloudId = providedCloudId || (await getJiraCloudId(domain, accessToken))

    const cloudIdValidation = validateJiraCloudId(cloudId, 'cloudId')
    if (!cloudIdValidation.isValid) {
      return NextResponse.json({ error: cloudIdValidation.error }, { status: 400 })
    }

    if (projectId) {
      const projectIdValidation = validateAlphanumericId(projectId, 'projectId', 100)
      if (!projectIdValidation.isValid) {
        return NextResponse.json({ error: projectIdValidation.error }, { status: 400 })
      }
    }
    if (manualProjectId) {
      const manualProjectIdValidation = validateAlphanumericId(
        manualProjectId,
        'manualProjectId',
        100
      )
      if (!manualProjectIdValidation.isValid) {
        return NextResponse.json({ error: manualProjectIdValidation.error }, { status: 400 })
      }
    }

    let data: any

    if (query || projectId || manualProjectId) {
      const SAFETY_CAP = 1000
      const PAGE_SIZE = 100
      const target = Math.min(all ? limit || SAFETY_CAP : 25, SAFETY_CAP)
      const projectKey = (projectId || manualProjectId || '').trim()

      const escapeJql = (s: string) => s.replace(/\\/g, '\\\\').replace(/"/g, '\\"')

      const buildUrl = (token?: string) => {
        const jqlParts: string[] = []
        if (projectKey) jqlParts.push(`project = "${escapeJql(projectKey)}"`)
        if (query) {
          const q = escapeJql(query)
          jqlParts.push(`(key ~ "${q}" OR summary ~ "${q}")`)
        }
        const jql = `${jqlParts.length ? `${jqlParts.join(' AND ')} ` : ''}ORDER BY updated DESC`
        const params = new URLSearchParams({
          jql,
          fields: 'summary,key,updated',
          maxResults: String(Math.min(PAGE_SIZE, target)),
        })
        if (token) params.set('nextPageToken', token)
        return `https://api.atlassian.com/ex/jira/${cloudId}/rest/api/3/search/jql?${params.toString()}`
      }

      let nextPageToken: string | undefined
      let collected: any[] = []

      do {
        const apiUrl = buildUrl(nextPageToken)
        const response = await fetch(apiUrl, {
          method: 'GET',
          headers: {
            Authorization: `Bearer ${accessToken}`,
            Accept: 'application/json',
          },
        })

        if (!response.ok) {
          const errorMessage = await createErrorResponse(response)
          if (response.status === 401 || response.status === 403) {
            return NextResponse.json(
              {
                error: errorMessage,
                authRequired: true,
                requiredScopes: ['read:jira-work'],
              },
              { status: response.status }
            )
          }
          return NextResponse.json({ error: errorMessage }, { status: response.status })
        }

        const page = await response.json()
        const issues = page.issues || []
        collected = collected.concat(issues)
        nextPageToken = page.nextPageToken
        if (!nextPageToken || issues.length === 0) break
      } while (all && collected.length < target)

      const issues = collected.slice(0, target).map((it: any) => ({
        key: it.key,
        summary: it.fields?.summary || it.key,
      }))
      data = { sections: [{ issues }], cloudId }
    } else {
      data = { sections: [], cloudId }
    }

    return NextResponse.json({ ...data, cloudId })
  } catch (error) {
    logger.error('Error fetching Jira issue suggestions:', error)
    return NextResponse.json(
      { error: (error as Error).message || 'Internal server error' },
      { status: 500 }
    )
  }
})
