import { createLogger } from '@sim/logger'
import { type NextRequest, NextResponse } from 'next/server'
import {
  jiraIssueSelectorContract,
  jiraIssuesSelectorContract,
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

const logger = createLogger('JiraIssuesAPI')

export const POST = withRouteHandler(async (request: NextRequest) => {
  try {
    const authentication = await authenticateSelectorRequest(request)
    if (!authentication.ok) {
      return NextResponse.json({ error: authentication.error }, { status: authentication.status })
    }
    const parsed = await parseRequest(jiraIssueSelectorContract, request, {})
    if (!parsed.success) return parsed.response

    const { credential, workflowId, domain: domainReference, issueKeys } = parsed.data.body

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
    const resolution = await resolveAuthorizedSelectorContext(authentication.principal, {
      workflowId,
      credentialId: credential,
      context: { domain: domainReference },
    })
    if (!resolution.ok) {
      return NextResponse.json({ error: resolution.error }, { status: resolution.status })
    }
    if (sanitizedKeys.length === 0) {
      logger.info('No issue keys provided, returning empty result')
      return NextResponse.json({ issues: [] })
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
      logger.warn('Jira selector issue detail request failed', { status: response.status })
      const failure = selectorProviderFailure('Jira', response.status)
      return NextResponse.json(failure, { status: failure.status })
    }

    const data = await response.json()
    const issues = (data.issues || []).map((it: any) => ({
      id: it.key,
      name: it.fields?.summary || it.key,
    }))

    return NextResponse.json({ issues })
  } catch {
    logger.error('Error fetching Jira issues')
    return NextResponse.json({ error: 'Failed to retrieve Jira issues' }, { status: 500 })
  }
})

export const GET = withRouteHandler(async (request: NextRequest) => {
  try {
    const authentication = await authenticateSelectorRequest(request)
    if (!authentication.ok) {
      return NextResponse.json({ error: authentication.error }, { status: authentication.status })
    }
    const parsed = await parseRequest(jiraIssuesSelectorContract, request, {})
    if (!parsed.success) return parsed.response

    const {
      credential,
      workflowId,
      domain: domainReference,
      query = '',
      projectId = '',
      manualProjectId = '',
      all,
      limit,
    } = parsed.data.query

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
          logger.warn('Jira selector issue request failed', { status: response.status })
          const failure = selectorProviderFailure('Jira', response.status)
          return NextResponse.json(failure, { status: failure.status })
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
      data = { sections: [{ issues }] }
    } else {
      data = { sections: [] }
    }

    return NextResponse.json(data)
  } catch {
    logger.error('Error fetching Jira issue suggestions')
    return NextResponse.json({ error: 'Failed to retrieve Jira issues' }, { status: 500 })
  }
})
