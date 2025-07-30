import { NextResponse } from 'next/server'
import { Logger } from '@/lib/logs/console/logger'
import { getJiraCloudId } from '@/tools/jira/utils'

export const dynamic = 'force-dynamic'

const logger = new Logger('JiraIssueAPI')

export async function POST(request: Request) {
  try {
    const { domain, accessToken, issueId, cloudId: providedCloudId } = await request.json()
    // Add detailed request logging
    if (!domain) {
      logger.error('Missing domain in request')
      return NextResponse.json({ error: 'Domain is required' }, { status: 400 })
    }

    if (!accessToken) {
      logger.error('Missing access token in request')
      return NextResponse.json({ error: 'Access token is required' }, { status: 400 })
    }

    if (!issueId) {
      logger.error('Missing issue ID in request')
      return NextResponse.json({ error: 'Issue ID is required' }, { status: 400 })
    }

    // Use provided cloudId or fetch it if not provided
    const cloudId = providedCloudId || (await getJiraCloudId(domain, accessToken))
    logger.info('Using cloud ID:', cloudId)

    // Build the URL using cloudId for Jira API
    const url = `https://api.atlassian.com/ex/jira/${cloudId}/rest/api/3/issue/${issueId}`

    logger.info('Fetching Jira issue from:', url)

    // Make the request to Jira API
    const response = await fetch(url, {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        Accept: 'application/json',
      },
    })

    if (!response.ok) {
      logger.error('Jira API error:', {
        status: response.status,
        statusText: response.statusText,
      })

      let errorMessage
      try {
        const errorData = await response.json()
        logger.error('Error details:', errorData)
        errorMessage = errorData.message || `Failed to fetch issue (${response.status})`
      } catch (_e) {
        errorMessage = `Failed to fetch issue: ${response.status} ${response.statusText}`
      }
      return NextResponse.json({ error: errorMessage }, { status: response.status })
    }

    const data = await response.json()
    logger.info('Successfully fetched issue:', data.key)

    // Transform the Jira issue data into our expected format
    const issueInfo: any = {
      id: data.key,
      name: data.fields.summary,
      mimeType: 'jira/issue',
      url: `https://${domain}/browse/${data.key}`,
      modifiedTime: data.fields.updated,
      webViewLink: `https://${domain}/browse/${data.key}`,
      // Add additional fields that might be needed for the workflow
      status: data.fields.status?.name,
      description: data.fields.description,
      priority: data.fields.priority?.name,
      assignee: data.fields.assignee?.displayName,
      reporter: data.fields.reporter?.displayName,
      project: {
        key: data.fields.project?.key,
        name: data.fields.project?.name,
      },
    }

    return NextResponse.json({
      issue: issueInfo,
      cloudId, // Return the cloudId so it can be cached
    })
  } catch (error) {
    logger.error('Error processing request:', error)
    // Add more context to the error response
    return NextResponse.json(
      {
        error: 'Failed to retrieve Jira issue',
        details: (error as Error).message,
      },
      { status: 500 }
    )
  }
}
