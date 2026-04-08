import { createLogger } from '@sim/logger'
import { JiraIcon } from '@/components/icons'
import { fetchWithRetry, VALIDATE_RETRY_OPTIONS } from '@/lib/knowledge/documents/utils'
import type { ConnectorConfig, ExternalDocument, ExternalDocumentList } from '@/connectors/types'
import { joinTagArray, parseTagDate } from '@/connectors/utils'
import { extractAdfText, getJiraCloudId } from '@/tools/jira/utils'

const logger = createLogger('JiraConnector')

const PAGE_SIZE = 50

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
 * Extracts common metadata fields from a Jira issue into an ExternalDocument
 * stub with deferred content. The contentHash is metadata-based so it is
 * identical whether produced during listing or full fetch.
 */
function issueToStub(issue: Record<string, unknown>, domain: string): ExternalDocument {
  const fields = (issue.fields || {}) as Record<string, unknown>
  const key = issue.key as string
  const issueType = fields.issuetype as Record<string, unknown> | undefined
  const status = fields.status as Record<string, unknown> | undefined
  const priority = fields.priority as Record<string, unknown> | undefined
  const assignee = fields.assignee as Record<string, unknown> | undefined
  const reporter = fields.reporter as Record<string, unknown> | undefined
  const project = fields.project as Record<string, unknown> | undefined
  const labels = Array.isArray(fields.labels) ? (fields.labels as string[]) : []
  const updated = (fields.updated as string) ?? ''

  return {
    externalId: String(issue.id),
    title: `${key}: ${(fields.summary as string) || 'Untitled'}`,
    content: '',
    contentDeferred: true,
    mimeType: 'text/plain',
    sourceUrl: `https://${domain}/browse/${key}`,
    contentHash: `jira:${issue.id}:${updated}`,
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

/**
 * Converts a fully-fetched Jira issue (with description and comments) into an
 * ExternalDocument with resolved content.
 */
function issueToFullDocument(issue: Record<string, unknown>, domain: string): ExternalDocument {
  const stub = issueToStub(issue, domain)
  const fields = (issue.fields || {}) as Record<string, unknown>
  const content = buildIssueContent(fields)

  return {
    ...stub,
    content,
    contentDeferred: false,
  }
}

export const jiraConnector: ConnectorConfig = {
  id: 'jira',
  name: 'Jira',
  description: 'Sync issues from a Jira project into your knowledge base',
  version: '1.0.0',
  icon: JiraIcon,

  auth: { mode: 'oauth', provider: 'jira', requiredScopes: ['read:jira-work', 'offline_access'] },

  configFields: [
    {
      id: 'domain',
      title: 'Jira Domain',
      type: 'short-input',
      placeholder: 'yoursite.atlassian.net',
      required: true,
    },
    {
      id: 'projectSelector',
      title: 'Project',
      type: 'selector',
      selectorKey: 'jira.projects',
      canonicalParamId: 'projectKey',
      mode: 'basic',
      dependsOn: ['domain'],
      placeholder: 'Select a project',
      required: true,
    },
    {
      id: 'projectKey',
      title: 'Project Key',
      type: 'short-input',
      canonicalParamId: 'projectKey',
      mode: 'advanced',
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
    cursor?: string,
    syncContext?: Record<string, unknown>
  ): Promise<ExternalDocumentList> => {
    const domain = sourceConfig.domain as string
    const projectKey = sourceConfig.projectKey as string
    const jqlFilter = (sourceConfig.jql as string) || ''
    const maxIssues = sourceConfig.maxIssues ? Number(sourceConfig.maxIssues) : 0

    let cloudId = syncContext?.cloudId as string | undefined
    if (!cloudId) {
      cloudId = await getJiraCloudId(domain, accessToken)
      if (syncContext) syncContext.cloudId = cloudId
    }

    const safeKey = projectKey.replace(/\\/g, '\\\\').replace(/"/g, '\\"')
    let jql = `project = "${safeKey}" ORDER BY updated DESC`
    if (jqlFilter.trim()) {
      jql = `project = "${safeKey}" AND (${jqlFilter.trim()}) ORDER BY updated DESC`
    }

    const startAt = cursor ? Number(cursor) : 0

    const params = new URLSearchParams()
    params.append('jql', jql)
    params.append('startAt', String(startAt))
    const remaining = maxIssues > 0 ? Math.max(0, maxIssues - startAt) : PAGE_SIZE
    if (remaining === 0) {
      return { documents: [], hasMore: false }
    }
    params.append('maxResults', String(Math.min(PAGE_SIZE, remaining)))
    params.append(
      'fields',
      'summary,issuetype,status,priority,assignee,reporter,project,labels,created,updated'
    )

    const url = `https://api.atlassian.com/ex/jira/${cloudId}/rest/api/3/search?${params.toString()}`

    logger.info(`Listing Jira issues for project ${projectKey}`, { startAt })

    const response = await fetchWithRetry(url, {
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

    const documents: ExternalDocument[] = issues.map((issue) => issueToStub(issue, domain))

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
    externalId: string,
    syncContext?: Record<string, unknown>
  ): Promise<ExternalDocument | null> => {
    const domain = sourceConfig.domain as string
    let cloudId = syncContext?.cloudId as string | undefined
    if (!cloudId) {
      cloudId = await getJiraCloudId(domain, accessToken)
      if (syncContext) syncContext.cloudId = cloudId
    }

    const params = new URLSearchParams()
    params.append(
      'fields',
      'summary,description,comment,issuetype,status,priority,assignee,reporter,project,labels,created,updated'
    )

    const url = `https://api.atlassian.com/ex/jira/${cloudId}/rest/api/3/issue/${externalId}?${params.toString()}`

    const response = await fetchWithRetry(url, {
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
    return issueToFullDocument(issue, domain)
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

    const jqlFilter = (sourceConfig.jql as string | undefined)?.trim() || ''

    try {
      const cloudId = await getJiraCloudId(domain, accessToken)

      const params = new URLSearchParams()
      const safeKey = projectKey.replace(/\\/g, '\\\\').replace(/"/g, '\\"')
      params.append('jql', `project = "${safeKey}"`)
      params.append('maxResults', '0')

      const url = `https://api.atlassian.com/ex/jira/${cloudId}/rest/api/3/search?${params.toString()}`
      const response = await fetchWithRetry(
        url,
        {
          method: 'GET',
          headers: {
            Accept: 'application/json',
            Authorization: `Bearer ${accessToken}`,
          },
        },
        VALIDATE_RETRY_OPTIONS
      )

      if (!response.ok) {
        const errorText = await response.text()
        if (response.status === 400) {
          return { valid: false, error: `Project "${projectKey}" not found or JQL is invalid` }
        }
        return { valid: false, error: `Failed to validate: ${response.status} - ${errorText}` }
      }

      if (jqlFilter) {
        const filterParams = new URLSearchParams()
        filterParams.append('jql', `project = "${safeKey}" AND (${jqlFilter})`)
        filterParams.append('maxResults', '0')

        const filterUrl = `https://api.atlassian.com/ex/jira/${cloudId}/rest/api/3/search?${filterParams.toString()}`
        const filterResponse = await fetchWithRetry(
          filterUrl,
          {
            method: 'GET',
            headers: {
              Accept: 'application/json',
              Authorization: `Bearer ${accessToken}`,
            },
          },
          VALIDATE_RETRY_OPTIONS
        )

        if (!filterResponse.ok) {
          return { valid: false, error: 'Invalid JQL filter. Check syntax and field names.' }
        }
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

    const labels = joinTagArray(metadata.labels)
    if (labels) result.labels = labels

    if (typeof metadata.assignee === 'string') result.assignee = metadata.assignee

    const updated = parseTagDate(metadata.updated)
    if (updated) result.updated = updated

    return result
  },
}
