import { createLogger } from '@sim/logger'
import { type NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { checkSessionOrInternalAuth } from '@/lib/auth/hybrid'
import { validateJiraCloudId, validateJiraIssueKey } from '@/lib/core/security/input-validation'
import { getJiraCloudId } from '@/tools/jira/utils'

export const dynamic = 'force-dynamic'

const logger = createLogger('JiraUpdateAPI')

const jiraUpdateSchema = z.object({
  domain: z.string().min(1, 'Domain is required'),
  accessToken: z.string().min(1, 'Access token is required'),
  issueKey: z.string().min(1, 'Issue key is required'),
  summary: z.string().optional(),
  title: z.string().optional(),
  description: z.string().optional(),
  priority: z.string().optional(),
  assignee: z.string().optional(),
  labels: z.array(z.string()).optional(),
  components: z.array(z.string()).optional(),
  duedate: z.string().optional(),
  fixVersions: z.array(z.string()).optional(),
  environment: z.string().optional(),
  customFieldId: z.string().optional(),
  customFieldValue: z.string().optional(),
  notifyUsers: z.boolean().optional(),
  cloudId: z.string().optional(),
})

export async function PUT(request: NextRequest) {
  try {
    const auth = await checkSessionOrInternalAuth(request)
    if (!auth.success || !auth.userId) {
      return NextResponse.json({ error: auth.error || 'Unauthorized' }, { status: 401 })
    }

    const body = await request.json()
    const validation = jiraUpdateSchema.safeParse(body)

    if (!validation.success) {
      const firstError = validation.error.errors[0]
      logger.error('Validation error:', firstError)
      return NextResponse.json({ error: firstError.message }, { status: 400 })
    }

    const {
      domain,
      accessToken,
      issueKey,
      summary,
      title,
      description,
      priority,
      assignee,
      labels,
      components,
      duedate,
      fixVersions,
      environment,
      customFieldId,
      customFieldValue,
      notifyUsers,
      cloudId: providedCloudId,
    } = validation.data

    const cloudId = providedCloudId || (await getJiraCloudId(domain, accessToken))
    logger.info('Using cloud ID:', cloudId)

    const cloudIdValidation = validateJiraCloudId(cloudId, 'cloudId')
    if (!cloudIdValidation.isValid) {
      return NextResponse.json({ error: cloudIdValidation.error }, { status: 400 })
    }

    const issueKeyValidation = validateJiraIssueKey(issueKey, 'issueKey')
    if (!issueKeyValidation.isValid) {
      return NextResponse.json({ error: issueKeyValidation.error }, { status: 400 })
    }

    const notifyParam = notifyUsers === false ? '?notifyUsers=false' : ''
    const url = `https://api.atlassian.com/ex/jira/${cloudId}/rest/api/3/issue/${issueKey}${notifyParam}`

    logger.info('Updating Jira issue at:', url)

    const summaryValue = summary || title
    const fields: Record<string, any> = {}

    if (summaryValue !== undefined && summaryValue !== null && summaryValue !== '') {
      fields.summary = summaryValue
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

    if (priority !== undefined && priority !== null && priority !== '') {
      const isNumericId = /^\d+$/.test(priority)
      fields.priority = isNumericId ? { id: priority } : { name: priority }
    }

    if (assignee !== undefined && assignee !== null && assignee !== '') {
      fields.assignee = {
        accountId: assignee,
      }
    }

    if (labels !== undefined && labels !== null && labels.length > 0) {
      fields.labels = labels
    }

    if (components !== undefined && components !== null && components.length > 0) {
      fields.components = components.map((name) => ({ name }))
    }

    if (duedate !== undefined && duedate !== null && duedate !== '') {
      fields.duedate = duedate
    }

    if (fixVersions !== undefined && fixVersions !== null && fixVersions.length > 0) {
      fields.fixVersions = fixVersions.map((name) => ({ name }))
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

    const requestBody = { fields }

    const response = await fetch(url, {
      method: 'PUT',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        Accept: 'application/json',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(requestBody),
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

    const responseData = response.status === 204 ? {} : await response.json()
    logger.info('Successfully updated Jira issue:', issueKey)

    return NextResponse.json({
      success: true,
      output: {
        ts: new Date().toISOString(),
        issueKey: responseData.key || issueKey,
        summary: responseData.fields?.summary || 'Issue updated',
        success: true,
      },
    })
  } catch (error: any) {
    logger.error('Error updating Jira issue:', {
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
