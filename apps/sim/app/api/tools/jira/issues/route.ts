import { NextResponse } from 'next/server'
import { createLogger } from '@/lib/logs/console/logger'
import { validateAlphanumericId, validateJiraCloudId } from '@/lib/security/input-validation'
import { getJiraCloudId } from '@/tools/jira/utils'

export const dynamic = 'force-dynamic'

const logger = createLogger('JiraIssuesAPI')

const createErrorResponse = async (response: Response, defaultMessage: string) => {
  try {
    const errorData = await response.json()
    return errorData.message || errorData.errorMessages?.[0] || defaultMessage
  } catch {
    return defaultMessage
  }
}

const validateRequiredParams = (domain: string | null, accessToken: string | null) => {
  if (!domain) {
    return NextResponse.json({ error: 'Domain is required' }, { status: 400 })
  }
  if (!accessToken) {
    return NextResponse.json({ error: 'Access token is required' }, { status: 400 })
  }
  return null
}

export async function POST(request: Request) {
  try {
    const { domain, accessToken, issueKeys = [], cloudId: providedCloudId } = await request.json()

    const validationError = validateRequiredParams(domain || null, accessToken || null)
    if (validationError) return validationError

    if (issueKeys.length === 0) {
      logger.info('No issue keys provided, returning empty result')
      return NextResponse.json({ issues: [] })
    }

    const cloudId = providedCloudId || (await getJiraCloudId(domain!, accessToken!))

    const cloudIdValidation = validateJiraCloudId(cloudId, 'cloudId')
    if (!cloudIdValidation.isValid) {
      return NextResponse.json({ error: cloudIdValidation.error }, { status: 400 })
    }

    const url = `https://api.atlassian.com/ex/jira/${cloudId}/rest/api/3/issue/bulkfetch`

    const requestBody = {
      expand: ['names'],
      fields: ['summary', 'status', 'assignee', 'updated', 'project'],
      fieldsByKeys: false,
      issueIdsOrKeys: issueKeys,
      properties: [],
    }

    const requestConfig = {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        Accept: 'application/json',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(requestBody),
    }

    const response = await fetch(url, requestConfig)

    if (!response.ok) {
      logger.error(`Jira API error: ${response.status} ${response.statusText}`)
      const errorMessage = await createErrorResponse(
        response,
        `Failed to fetch Jira issues (${response.status})`
      )
      return NextResponse.json({ error: errorMessage }, { status: response.status })
    }

    const data = await response.json()
    const issues = (data.issues || []).map((issue: any) => ({
      id: issue.key,
      name: issue.fields.summary,
      mimeType: 'jira/issue',
      url: `https://${domain}/browse/${issue.key}`,
      modifiedTime: issue.fields.updated,
      webViewLink: `https://${domain}/browse/${issue.key}`,
    }))

    return NextResponse.json({ issues, cloudId })
  } catch (error) {
    logger.error('Error fetching Jira issues:', error)
    return NextResponse.json(
      { error: (error as Error).message || 'Internal server error' },
      { status: 500 }
    )
  }
}

export async function GET(request: Request) {
  try {
    const url = new URL(request.url)
    const domain = url.searchParams.get('domain')?.trim()
    const accessToken = url.searchParams.get('accessToken')
    const providedCloudId = url.searchParams.get('cloudId')
    const query = url.searchParams.get('query') || ''
    const projectId = url.searchParams.get('projectId') || ''
    const manualProjectId = url.searchParams.get('manualProjectId') || ''
    const all = url.searchParams.get('all')?.toLowerCase() === 'true'
    const limitParam = Number.parseInt(url.searchParams.get('limit') || '', 10)
    const limit = Number.isFinite(limitParam) && limitParam > 0 ? limitParam : 0

    const validationError = validateRequiredParams(domain || null, accessToken || null)
    if (validationError) return validationError

    const cloudId = providedCloudId || (await getJiraCloudId(domain!, accessToken!))

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

    if (query) {
      const params = new URLSearchParams({ query })
      const apiUrl = `https://api.atlassian.com/ex/jira/${cloudId}/rest/api/3/issue/picker?${params}`
      const response = await fetch(apiUrl, {
        headers: {
          Authorization: `Bearer ${accessToken}`,
          Accept: 'application/json',
        },
      })

      if (!response.ok) {
        const errorMessage = await createErrorResponse(
          response,
          `Failed to fetch issue suggestions (${response.status})`
        )
        return NextResponse.json({ error: errorMessage }, { status: response.status })
      }
      data = await response.json()
    } else if (projectId || manualProjectId) {
      const SAFETY_CAP = 1000
      const PAGE_SIZE = 100
      const target = Math.min(all ? limit || SAFETY_CAP : 25, SAFETY_CAP)
      const projectKey = (projectId || manualProjectId).trim()

      const buildSearchUrl = (startAt: number) => {
        const params = new URLSearchParams({
          jql: `project=${projectKey} ORDER BY updated DESC`,
          maxResults: String(Math.min(PAGE_SIZE, target)),
          startAt: String(startAt),
          fields: 'summary,key,updated',
        })
        return `https://api.atlassian.com/ex/jira/${cloudId}/rest/api/3/search?${params}`
      }

      let startAt = 0
      let collected: any[] = []
      let total = 0

      do {
        const response = await fetch(buildSearchUrl(startAt), {
          headers: {
            Authorization: `Bearer ${accessToken}`,
            Accept: 'application/json',
          },
        })

        if (!response.ok) {
          const errorMessage = await createErrorResponse(
            response,
            `Failed to fetch issues (${response.status})`
          )
          return NextResponse.json({ error: errorMessage }, { status: response.status })
        }

        const page = await response.json()
        const issues = page.issues || []
        total = page.total || issues.length
        collected = collected.concat(issues)
        startAt += PAGE_SIZE
      } while (all && collected.length < Math.min(total, target))

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
}
