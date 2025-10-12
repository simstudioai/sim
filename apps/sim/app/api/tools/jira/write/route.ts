import { NextResponse } from 'next/server'
import { createLogger } from '@/lib/logs/console/logger'
import { validateAlphanumericId, validateJiraCloudId } from '@/lib/security/input-validation'
import { getJiraCloudId } from '@/tools/jira/utils'

export const dynamic = 'force-dynamic'

const logger = createLogger('JiraWriteAPI')

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

    const normalizedIssueType = issueType || 'Task'

    const cloudId = providedCloudId || (await getJiraCloudId(domain, accessToken))
    logger.info('Using cloud ID:', cloudId)

    const cloudIdValidation = validateJiraCloudId(cloudId, 'cloudId')
    if (!cloudIdValidation.isValid) {
      return NextResponse.json({ error: cloudIdValidation.error }, { status: 400 })
    }

    const projectIdValidation = validateAlphanumericId(projectId, 'projectId', 100)
    if (!projectIdValidation.isValid) {
      return NextResponse.json({ error: projectIdValidation.error }, { status: 400 })
    }

    const url = `https://api.atlassian.com/ex/jira/${cloudId}/rest/api/3/issue`

    logger.info('Creating Jira issue at:', url)

    const fields: Record<string, any> = {
      project: {
        id: projectId,
      },
      issuetype: {
        name: normalizedIssueType,
      },
      summary: summary,
    }

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

    if (parent) {
      fields.parent = parent
    }

    if (priority) {
      fields.priority = {
        name: priority,
      }
    }

    if (assignee) {
      fields.assignee = {
        id: assignee,
      }
    }

    const body = { fields }

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
