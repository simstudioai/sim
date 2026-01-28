import { createLogger } from '@sim/logger'
import { type NextRequest, NextResponse } from 'next/server'
import { checkSessionOrInternalAuth } from '@/lib/auth/hybrid'
import { validateAlphanumericId, validateJiraCloudId } from '@/lib/core/security/input-validation'
import { getJiraCloudId } from '@/tools/jira/utils'

export const dynamic = 'force-dynamic'

const logger = createLogger('JiraWriteAPI')

export async function POST(request: NextRequest) {
  try {
    const auth = await checkSessionOrInternalAuth(request)
    if (!auth.success || !auth.userId) {
      return NextResponse.json({ error: auth.error || 'Unauthorized' }, { status: 401 })
    }

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
      labels,
      duedate,
      reporter,
      environment,
      customFieldId,
      customFieldValue,
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

    if (description !== undefined && description !== null && description !== '') {
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

    if (parent !== undefined && parent !== null && parent !== '') {
      fields.parent = parent
    }

    if (priority !== undefined && priority !== null && priority !== '') {
      const isNumericId = /^\d+$/.test(priority)
      fields.priority = isNumericId ? { id: priority } : { name: priority }
    }

    if (labels !== undefined && labels !== null && Array.isArray(labels) && labels.length > 0) {
      fields.labels = labels
    }

    if (duedate !== undefined && duedate !== null && duedate !== '') {
      fields.duedate = duedate
    }

    if (reporter !== undefined && reporter !== null && reporter !== '') {
      fields.reporter = {
        id: reporter,
      }
    }

    if (environment !== undefined && environment !== null && environment !== '') {
      fields.environment = {
        type: 'doc',
        version: 1,
        content: [
          {
            type: 'paragraph',
            content: [
              {
                type: 'text',
                text: environment,
              },
            ],
          },
        ],
      }
    }

    if (
      customFieldId !== undefined &&
      customFieldId !== null &&
      customFieldId !== '' &&
      customFieldValue !== undefined &&
      customFieldValue !== null &&
      customFieldValue !== ''
    ) {
      const fieldId = customFieldId.startsWith('customfield_')
        ? customFieldId
        : `customfield_${customFieldId}`

      fields[fieldId] = customFieldValue
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
    const issueKey = responseData.key || 'unknown'
    logger.info('Successfully created Jira issue:', issueKey)

    let assigneeId: string | undefined
    if (assignee !== undefined && assignee !== null && assignee !== '') {
      const assignUrl = `https://api.atlassian.com/ex/jira/${cloudId}/rest/api/3/issue/${issueKey}/assignee`
      logger.info('Assigning issue to:', assignee)

      const assignResponse = await fetch(assignUrl, {
        method: 'PUT',
        headers: {
          Authorization: `Bearer ${accessToken}`,
          Accept: 'application/json',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          accountId: assignee,
        }),
      })

      if (!assignResponse.ok) {
        const assignErrorText = await assignResponse.text()
        logger.warn('Failed to assign issue (issue was created successfully):', {
          status: assignResponse.status,
          error: assignErrorText,
        })
      } else {
        assigneeId = assignee
        logger.info('Successfully assigned issue to:', assignee)
      }
    }

    return NextResponse.json({
      success: true,
      output: {
        ts: new Date().toISOString(),
        issueKey: issueKey,
        summary: responseData.fields?.summary || 'Issue created',
        success: true,
        url: `https://${domain}/browse/${issueKey}`,
        ...(assigneeId && { assigneeId }),
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
