import { createLogger } from '@sim/logger'
import { JiraIcon } from '@/components/icons'
import type { ConnectorConfig, ExternalDocument, ExternalDocumentList } from '@/connectors/types'
import { extractAdfText, getJiraCloudId } from '@/tools/jira/utils'

const logger = createLogger('JiraConnector')

const PAGE_SIZE = 50

/**
 * Computes a SHA-256 hash of the given content.
 */
async function computeContentHash(content: string): Promise<string> {
  const data = new TextEncoder().encode(content)
  const hashBuffer = await crypto.subtle.digest('SHA-256', data)
  return Array.from(new Uint8Array(hashBuffer))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')
}

/**
 * Builds a plain-text representation of a Jira issue for knowledge base indexing.
 */
function buildIssueContent(fields: Record<string, unknown>): string {
  const parts: string[] = []

  const summary = fields.summary as string | undefined
  if (summary) parts.push(summary)

  const description = extractAdfText(fields.description)
  if (description) parts.push(description)

  const comments = fields.comment as { comments?: Array<{ body?: unknown }> } | undefined
  if (comments?.comments) {
    for (const comment of comments.comments) {
      const text = extractAdfText(comment.body)
      if (text) parts.push(text)
    }
  }

  return parts.join('\n\n').trim()
}

/**
 * Converts a Jira issue API response to an ExternalDocument.
 */
async function issueToDocument(
  issue: Record<string, unknown>,
  domain: string
): Promise<ExternalDocument> {
  const fields = (issue.fields || {}) as Record<string, unknown>
  const content = buildIssueContent(fields)
  const contentHash = await computeContentHash(content)

  const key = issue.key as string
  const issueType = fields.issuetype as Record<string, unknown> | undefined
  const status = fields.status as Record<string, unknown> | undefined
  const priority = fields.priority as Record<string, unknown> | undefined
  const assignee = fields.assignee as Record<string, unknown> | undefined
  const reporter = fields.reporter as Record<string, unknown> | undefined
  const project = fields.project as Record<string, unknown> | undefined
  const labels = Array.isArray(fields.labels) ? (fields.labels as string[]) : []

  return {
    externalId: String(issue.id),
    title: `${key}: ${(fields.summary as string) || 'Untitled'}`,
    content,
    mimeType: 'text/plain',
    sourceUrl: `https://${domain}/browse/${key}`,
    contentHash,
    metadata: {
      key,
      issueType: issueType?.name,
      status: status?.name,
      priority: priority?.name,
      assignee: assignee?.displayName,
      reporter: reporter?.displayName,
      project: project?.key,
      labels,
      created: fields.created,
      updated: fields.updated,
    },
  }
}

export const jiraConnector: ConnectorConfig = {
  id: 'jira',
  name: 'Jira',
  description: 'Sync issues from a Jira project into your knowledge base',
  version: '1.0.0',
  icon: JiraIcon,

  oauth: {
    required: true,
    provider: 'jira',
    requiredScopes: ['read:jira-work', 'offline_access'],
  },

  configFields: [
    {
      id: 'domain',
      title: 'Jira Domain',
      type: 'short-input',
      placeholder: 'yoursite.atlassian.net',
      required: true,
    },
    {
      id: 'projectKey',
      title: 'Project Key',
      type: 'short-input',
      placeholder: 'e.g. ENG, PROJ',
      required: true,
    },
    {
      id: 'jql',
      title: 'JQL Filter',
      type: 'short-input',
      required: false,
      placeholder: 'e.g. status = "Done" AND type = Bug',
    },
    {
      id: 'maxIssues',
      title: 'Max Issues',
      type: 'short-input',
      required: false,
      placeholder: 'e.g. 500 (default: unlimited)',
    },
  ],

  listDocuments: async (
    accessToken: string,
    sourceConfig: Record<string, unknown>,
    cursor?: string
  ): Promise<ExternalDocumentList> => {
    const domain = sourceConfig.domain as string
    const projectKey = sourceConfig.projectKey as string
    const jqlFilter = (sourceConfig.jql as string) || ''
    const maxIssues = sourceConfig.maxIssues ? Number(sourceConfig.maxIssues) : 0

    const cloudId = await getJiraCloudId(domain, accessToken)

    let jql = `project = "${projectKey}" ORDER BY updated DESC`
    if (jqlFilter.trim()) {
      jql = `project = "${projectKey}" AND (${jqlFilter.trim()}) ORDER BY updated DESC`
    }

    const startAt = cursor ? Number(cursor) : 0

    const params = new URLSearchParams()
    params.append('jql', jql)
    params.append('startAt', String(startAt))
    params.append('maxResults', String(PAGE_SIZE))
    params.append(
      'fields',
      'summary,description,comment,issuetype,status,priority,assignee,reporter,project,labels,created,updated'
    )

    const url = `https://api.atlassian.com/ex/jira/${cloudId}/rest/api/3/search?${params.toString()}`

    logger.info(`Listing Jira issues for project ${projectKey}`, { startAt })

    const response = await fetch(url, {
      method: 'GET',
      headers: {
        Accept: 'application/json',
        Authorization: `Bearer ${accessToken}`,
      },
    })

    if (!response.ok) {
      const errorText = await response.text()
      logger.error('Failed to search Jira issues', {
        status: response.status,
        error: errorText,
      })
      throw new Error(`Failed to search Jira issues: ${response.status}`)
    }

    const data = await response.json()
    const issues = (data.issues || []) as Record<string, unknown>[]
    const total = (data.total as number) ?? 0

    const documents: ExternalDocument[] = await Promise.all(
      issues.map((issue) => issueToDocument(issue, domain))
    )

    const nextStart = startAt + issues.length
    const hasMore = nextStart < total && (maxIssues <= 0 || nextStart < maxIssues)

    return {
      documents,
      nextCursor: hasMore ? String(nextStart) : undefined,
      hasMore,
    }
  },

  getDocument: async (
    accessToken: string,
    sourceConfig: Record<string, unknown>,
    externalId: string
  ): Promise<ExternalDocument | null> => {
    const domain = sourceConfig.domain as string
    const cloudId = await getJiraCloudId(domain, accessToken)

    const params = new URLSearchParams()
    params.append(
      'fields',
      'summary,description,comment,issuetype,status,priority,assignee,reporter,project,labels,created,updated'
    )

    const url = `https://api.atlassian.com/ex/jira/${cloudId}/rest/api/3/issue/${externalId}?${params.toString()}`

    const response = await fetch(url, {
      method: 'GET',
      headers: {
        Accept: 'application/json',
        Authorization: `Bearer ${accessToken}`,
      },
    })

    if (!response.ok) {
      if (response.status === 404) return null
      throw new Error(`Failed to get Jira issue: ${response.status}`)
    }

    const issue = await response.json()
    return issueToDocument(issue, domain)
  },

  validateConfig: async (
    accessToken: string,
    sourceConfig: Record<string, unknown>
  ): Promise<{ valid: boolean; error?: string }> => {
    const domain = sourceConfig.domain as string
    const projectKey = sourceConfig.projectKey as string

    if (!domain || !projectKey) {
      return { valid: false, error: 'Domain and project key are required' }
    }

    const maxIssues = sourceConfig.maxIssues as string | undefined
    if (maxIssues && (Number.isNaN(Number(maxIssues)) || Number(maxIssues) <= 0)) {
      return { valid: false, error: 'Max issues must be a positive number' }
    }

    const jql = sourceConfig.jql as string | undefined
    if (jql?.trim()) {
      if (/\b(delete|drop|truncate|insert|update|alter|create|grant|revoke)\b/i.test(jql)) {
        return { valid: false, error: 'Invalid JQL filter' }
      }
    }

    try {
      const cloudId = await getJiraCloudId(domain, accessToken)

      // Verify the project exists by running a minimal search
      const params = new URLSearchParams()
      params.append('jql', `project = "${projectKey}"`)
      params.append('maxResults', '0')

      const url = `https://api.atlassian.com/ex/jira/${cloudId}/rest/api/3/search?${params.toString()}`
      const response = await fetch(url, {
        method: 'GET',
        headers: {
          Accept: 'application/json',
          Authorization: `Bearer ${accessToken}`,
        },
      })

      if (!response.ok) {
        const errorText = await response.text()
        if (response.status === 400) {
          return { valid: false, error: `Project "${projectKey}" not found or JQL is invalid` }
        }
        return { valid: false, error: `Failed to validate: ${response.status} - ${errorText}` }
      }

      return { valid: true }
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to validate configuration'
      return { valid: false, error: message }
    }
  },

  tagDefinitions: [
    { id: 'issueType', displayName: 'Issue Type', fieldType: 'text' },
    { id: 'status', displayName: 'Status', fieldType: 'text' },
    { id: 'priority', displayName: 'Priority', fieldType: 'text' },
    { id: 'labels', displayName: 'Labels', fieldType: 'text' },
    { id: 'assignee', displayName: 'Assignee', fieldType: 'text' },
    { id: 'updated', displayName: 'Last Updated', fieldType: 'date' },
  ],

  mapTags: (metadata: Record<string, unknown>): Record<string, unknown> => {
    const result: Record<string, unknown> = {}

    if (typeof metadata.issueType === 'string') result.issueType = metadata.issueType
    if (typeof metadata.status === 'string') result.status = metadata.status
    if (typeof metadata.priority === 'string') result.priority = metadata.priority

    const labels = Array.isArray(metadata.labels) ? (metadata.labels as string[]) : []
    if (labels.length > 0) result.labels = labels.join(', ')

    if (typeof metadata.assignee === 'string') result.assignee = metadata.assignee

    if (typeof metadata.updated === 'string') {
      const date = new Date(metadata.updated)
      if (!Number.isNaN(date.getTime())) result.updated = date
    }

    return result
  },
}
