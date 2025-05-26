import { NextResponse } from 'next/server'
import { Logger } from '@/lib/logs/console-logger'
import { getJiraCloudId } from '@/tools/jira/utils'

export const dynamic = 'force-dynamic'

const logger = new Logger('JiraIssuesAPI')

export async function POST(request: Request) {
  try {
    const { domain, accessToken, issueKeys = [], cloudId: providedCloudId } = await request.json()

    if (!domain) {
      return NextResponse.json({ error: 'Domain is required' }, { status: 400 })
    }

    if (!accessToken) {
      return NextResponse.json({ error: 'Access token is required' }, { status: 400 })
    }

    if (issueKeys.length === 0) {
      logger.info('No issue keys provided, returning empty result')
      return NextResponse.json({ issues: [] })
    }

    // Use provided cloudId or fetch it if not provided
    const cloudId = providedCloudId || (await getJiraCloudId(domain, accessToken))

    // Build the URL using cloudId for Jira API
    const url = `https://api.atlassian.com/ex/jira/${cloudId}/rest/api/3/issue/bulkfetch`

    // Prepare the request body for bulk fetch
    const requestBody = {
      expand: ['names'],
      fields: ['summary', 'status', 'assignee', 'updated', 'project'],
      fieldsByKeys: false,
      issueIdsOrKeys: issueKeys,
      properties: [],
    }

    // Make the request to Jira API with OAuth Bearer token
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
      let errorMessage

      try {
        const errorData = await response.json()
        logger.error('Error details:', JSON.stringify(errorData, null, 2))
        errorMessage = errorData.message || `Failed to fetch Jira issues (${response.status})`
      } catch (e) {
        logger.error('Could not parse error response as JSON:', e)

        try {
          const _text = await response.text()
          errorMessage = `Failed to fetch Jira issues: ${response.status} ${response.statusText}`
        } catch (_textError) {
          errorMessage = `Failed to fetch Jira issues: ${response.status} ${response.statusText}`
        }
      }

      return NextResponse.json({ error: errorMessage }, { status: response.status })
    }

    const data = await response.json()

    if (data.issues && data.issues.length > 0) {
      data.issues.slice(0, 3).forEach((issue: any) => {
        logger.info(`- ${issue.key}: ${issue.fields.summary}`)
      })
    }

    return NextResponse.json({
      issues: data.issues
        ? data.issues.map((issue: any) => ({
            id: issue.key,
            name: issue.fields.summary,
            mimeType: 'jira/issue',
            url: `https://${domain}/browse/${issue.key}`,
            modifiedTime: issue.fields.updated,
            webViewLink: `https://${domain}/browse/${issue.key}`,
          }))
        : [],
      cloudId, // Return the cloudId so it can be cached
    })
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

    if (!domain) {
      return NextResponse.json({ error: 'Domain is required' }, { status: 400 })
    }

    if (!accessToken) {
      return NextResponse.json({ error: 'Access token is required' }, { status: 400 })
    }

    // Use provided cloudId or fetch it if not provided
    const cloudId = providedCloudId || (await getJiraCloudId(domain, accessToken))
    logger.info('Using cloud ID:', cloudId)

    // Build query parameters
    const params = new URLSearchParams()

    // Only add query if it exists
    if (query) {
      params.append('query', query)
    }

    // Use the correct Jira Cloud OAuth endpoint structure
    const apiUrl = `https://api.atlassian.com/ex/jira/${cloudId}/rest/api/3/issue/picker?${params.toString()}`

    logger.info(`Fetching Jira issue suggestions from: ${apiUrl}`)

    const response = await fetch(apiUrl, {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        Accept: 'application/json',
      },
    })

    logger.info('Response status:', response.status, response.statusText)

    if (!response.ok) {
      logger.error(`Jira API error: ${response.status} ${response.statusText}`)
      let errorMessage
      try {
        const errorData = await response.json()
        logger.error('Error details:', errorData)
        errorMessage = errorData.message || `Failed to fetch issue suggestions (${response.status})`
      } catch (_e) {
        errorMessage = `Failed to fetch issue suggestions: ${response.status} ${response.statusText}`
      }
      return NextResponse.json({ error: errorMessage }, { status: response.status })
    }

    const data = await response.json()

    return NextResponse.json({
      ...data,
      cloudId, // Return the cloudId so it can be cached
    })
  } catch (error) {
    logger.error('Error fetching Jira issue suggestions:', error)
    return NextResponse.json(
      { error: (error as Error).message || 'Internal server error' },
      { status: 500 }
    )
  }
}
