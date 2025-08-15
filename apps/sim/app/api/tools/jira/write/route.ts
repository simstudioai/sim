import { NextResponse } from 'next/server'
import { Logger } from '@/lib/logs/console/logger'
import { getJiraCloudId } from '@/tools/jira/utils'

export const dynamic = 'force-dynamic'

const logger = new Logger('JiraWriteAPI')

export async function POST(request: Request) {
  try {
    const {
      domain,
      accessToken,
      projectId,
      summary,
      description,
      priority,
      assignee,
      cloudId: providedCloudId,
      issueType,
      parent,
    } = await request.json()

    // Validate required parameters
    if (!domain) {
      logger.error('Missing domain in request')
      return NextResponse.json({ error: 'Domain is required' }, { status: 400 })
    }

    if (!accessToken) {
      logger.error('Missing access token in request')
      return NextResponse.json({ error: 'Access token is required' }, { status: 400 })
    }

    if (!projectId) {
      logger.error('Missing project ID in request')
      return NextResponse.json({ error: 'Project ID is required' }, { status: 400 })
    }

    if (!summary) {
      logger.error('Missing summary in request')
      return NextResponse.json({ error: 'Summary is required' }, { status: 400 })
    }

    if (!issueType) {
      logger.error('Missing issue type in request')
      return NextResponse.json({ error: 'Issue type is required' }, { status: 400 })
    }

    // Use provided cloudId or fetch it if not provided
    const cloudId = providedCloudId || (await getJiraCloudId(domain, accessToken))
    logger.info('Using cloud ID:', cloudId)

    // Build the URL using cloudId for Jira API
    const url = `https://api.atlassian.com/ex/jira/${cloudId}/rest/api/3/issue`

    logger.info('Creating Jira issue at:', url)

    // Construct fields object with only the necessary fields
    const fields: Record<string, any> = {
      project: {
        id: projectId,
      },
      issuetype: {
        name: issueType,
      },
      summary: summary,
    }

    // Only add description if it exists
    if (description) {
      fields.description = {
        type: 'doc',
        version: 1,
        content: [
          {
            type: 'paragraph',
            content: [
              {
                type: 'text',
                text: description,
              },
            ],
          },
        ],
      }
    }

    // Only add parent if it exists
    if (parent) {
      fields.parent = parent
    }

    // Only add priority if it exists
    if (priority) {
      fields.priority = {
        name: priority,
      }
    }

    // Only add assignee if it exists
    if (assignee) {
      fields.assignee = {
        id: assignee,
      }
    }

    const body = { fields }

    // Make the request to Jira API
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        Accept: 'application/json',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    })

    if (!response.ok) {
      const errorText = await response.text()
      logger.error('Jira API error:', {
        status: response.status,
        statusText: response.statusText,
        error: errorText,
      })

      return NextResponse.json(
        { error: `Jira API error: ${response.status} ${response.statusText}`, details: errorText },
        { status: response.status }
      )
    }

    const responseData = await response.json()
    logger.info('Successfully created Jira issue:', responseData.key)

    return NextResponse.json({
      success: true,
      output: {
        ts: new Date().toISOString(),
        issueKey: responseData.key || 'unknown',
        summary: responseData.fields?.summary || 'Issue created',
        success: true,
        url: `https://${domain}/browse/${responseData.key}`,
      },
    })
  } catch (error: any) {
    logger.error('Error creating Jira issue:', {
      error: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack : undefined,
    })

    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : 'Internal server error',
        success: false,
      },
      { status: 500 }
    )
  }
}
