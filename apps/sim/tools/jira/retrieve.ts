import { createLogger } from '@sim/logger'
import type { JiraRetrieveParams, JiraRetrieveResponse } from '@/tools/jira/types'
import { ISSUE_ITEM_PROPERTIES, TIMESTAMP_OUTPUT } from '@/tools/jira/types'
import { extractAdfText, getJiraCloudId, transformUser } from '@/tools/jira/utils'
import type { ToolConfig } from '@/tools/types'

const logger = createLogger('JiraRetrieveTool')

/**
 * Transforms a raw Jira API issue response into a fully typed output.
 */
function transformIssueData(data: any) {
  const fields = data?.fields ?? {}
  return {
    id: data?.id ?? '',
    issueKey: data?.key ?? '',
    key: data?.key ?? '',
    self: data?.self ?? '',
    summary: fields.summary ?? '',
    description: extractAdfText(fields.description),
    status: {
      id: fields.status?.id ?? '',
      name: fields.status?.name ?? '',
      description: fields.status?.description ?? null,
      statusCategory: fields.status?.statusCategory
        ? {
            id: fields.status.statusCategory.id,
            key: fields.status.statusCategory.key ?? '',
            name: fields.status.statusCategory.name ?? '',
            colorName: fields.status.statusCategory.colorName ?? '',
          }
        : undefined,
    },
    issuetype: {
      id: fields.issuetype?.id ?? '',
      name: fields.issuetype?.name ?? '',
      description: fields.issuetype?.description ?? null,
      subtask: fields.issuetype?.subtask ?? false,
      iconUrl: fields.issuetype?.iconUrl ?? null,
    },
    project: {
      id: fields.project?.id ?? '',
      key: fields.project?.key ?? '',
      name: fields.project?.name ?? '',
      projectTypeKey: fields.project?.projectTypeKey ?? null,
    },
    priority: fields.priority
      ? {
          id: fields.priority.id ?? '',
          name: fields.priority.name ?? '',
          iconUrl: fields.priority.iconUrl ?? null,
        }
      : null,
    assignee: transformUser(fields.assignee),
    reporter: transformUser(fields.reporter),
    creator: transformUser(fields.creator),
    labels: fields.labels ?? [],
    components: (fields.components ?? []).map((c: any) => ({
      id: c.id ?? '',
      name: c.name ?? '',
      description: c.description ?? null,
    })),
    fixVersions: (fields.fixVersions ?? []).map((v: any) => ({
      id: v.id ?? '',
      name: v.name ?? '',
      released: v.released ?? null,
      releaseDate: v.releaseDate ?? null,
    })),
    resolution: fields.resolution
      ? {
          id: fields.resolution.id ?? '',
          name: fields.resolution.name ?? '',
          description: fields.resolution.description ?? null,
        }
      : null,
    duedate: fields.duedate ?? null,
    created: fields.created ?? '',
    updated: fields.updated ?? '',
    resolutiondate: fields.resolutiondate ?? null,
    timetracking: fields.timetracking
      ? {
          originalEstimate: fields.timetracking.originalEstimate ?? null,
          remainingEstimate: fields.timetracking.remainingEstimate ?? null,
          timeSpent: fields.timetracking.timeSpent ?? null,
          originalEstimateSeconds: fields.timetracking.originalEstimateSeconds ?? null,
          remainingEstimateSeconds: fields.timetracking.remainingEstimateSeconds ?? null,
          timeSpentSeconds: fields.timetracking.timeSpentSeconds ?? null,
        }
      : null,
    parent: fields.parent
      ? {
          id: fields.parent.id ?? '',
          key: fields.parent.key ?? '',
          summary: fields.parent.fields?.summary ?? null,
        }
      : null,
    issuelinks: (fields.issuelinks ?? []).map((link: any) => ({
      id: link.id ?? '',
      type: {
        id: link.type?.id ?? '',
        name: link.type?.name ?? '',
        inward: link.type?.inward ?? '',
        outward: link.type?.outward ?? '',
      },
      inwardIssue: link.inwardIssue
        ? {
            id: link.inwardIssue.id ?? '',
            key: link.inwardIssue.key ?? '',
            statusName: link.inwardIssue.fields?.status?.name ?? null,
            summary: link.inwardIssue.fields?.summary ?? null,
          }
        : null,
      outwardIssue: link.outwardIssue
        ? {
            id: link.outwardIssue.id ?? '',
            key: link.outwardIssue.key ?? '',
            statusName: link.outwardIssue.fields?.status?.name ?? null,
            summary: link.outwardIssue.fields?.summary ?? null,
          }
        : null,
    })),
    subtasks: (fields.subtasks ?? []).map((sub: any) => ({
      id: sub.id ?? '',
      key: sub.key ?? '',
      summary: sub.fields?.summary ?? '',
      statusName: sub.fields?.status?.name ?? '',
      issueTypeName: sub.fields?.issuetype?.name ?? null,
    })),
    votes: fields.votes
      ? {
          votes: fields.votes.votes ?? 0,
          hasVoted: fields.votes.hasVoted ?? false,
        }
      : null,
    watches:
      (fields.watches ?? fields.watcher)
        ? {
            watchCount: (fields.watches ?? fields.watcher)?.watchCount ?? 0,
            isWatching: (fields.watches ?? fields.watcher)?.isWatching ?? false,
          }
        : null,
    comments: ((fields.comment?.comments ?? fields.comment) || []).map((c: any) => ({
      id: c.id ?? '',
      body: extractAdfText(c.body) ?? '',
      author: transformUser(c.author),
      updateAuthor: transformUser(c.updateAuthor),
      created: c.created ?? '',
      updated: c.updated ?? '',
    })),
    worklogs: ((fields.worklog?.worklogs ?? fields.worklog) || []).map((w: any) => ({
      id: w.id ?? '',
      author: transformUser(w.author),
      updateAuthor: transformUser(w.updateAuthor),
      comment: w.comment ? (extractAdfText(w.comment) ?? null) : null,
      started: w.started ?? '',
      timeSpent: w.timeSpent ?? '',
      timeSpentSeconds: w.timeSpentSeconds ?? 0,
      created: w.created ?? '',
      updated: w.updated ?? '',
    })),
    attachments: (fields.attachment ?? []).map((att: any) => ({
      id: att.id ?? '',
      filename: att.filename ?? '',
      mimeType: att.mimeType ?? '',
      size: att.size ?? 0,
      content: att.content ?? '',
      thumbnail: att.thumbnail ?? null,
      author: transformUser(att.author),
      created: att.created ?? '',
    })),
  }
}

export const jiraRetrieveTool: ToolConfig<JiraRetrieveParams, JiraRetrieveResponse> = {
  id: 'jira_retrieve',
  name: 'Jira Retrieve',
  description: 'Retrieve detailed information about a specific Jira issue',
  version: '1.0.0',

  oauth: {
    required: true,
    provider: 'jira',
  },

  params: {
    accessToken: {
      type: 'string',
      required: true,
      visibility: 'hidden',
      description: 'OAuth access token for Jira',
    },
    domain: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'Your Jira domain (e.g., yourcompany.atlassian.net)',
    },
    issueKey: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Jira issue key to retrieve (e.g., PROJ-123)',
    },
    cloudId: {
      type: 'string',
      required: false,
      visibility: 'hidden',
      description:
        'Jira Cloud ID for the instance. If not provided, it will be fetched using the domain.',
    },
  },

  request: {
    url: (params: JiraRetrieveParams) => {
      if (params.cloudId) {
        return `https://api.atlassian.com/ex/jira/${params.cloudId}/rest/api/3/issue/${params.issueKey}?expand=renderedFields,names,schema,transitions,operations,editmeta,changelog,versionedRepresentations`
      }
      return 'https://api.atlassian.com/oauth/token/accessible-resources'
    },
    method: 'GET',
    headers: (params: JiraRetrieveParams) => {
      return {
        Accept: 'application/json',
        Authorization: `Bearer ${params.accessToken}`,
      }
    },
  },

  transformResponse: async (response: Response, params?: JiraRetrieveParams) => {
    if (!params?.issueKey) {
      throw new Error('Provide an issue key to retrieve a single issue.')
    }

    const fetchIssue = async (cloudId: string) => {
      const issueUrl = `https://api.atlassian.com/ex/jira/${cloudId}/rest/api/3/issue/${params.issueKey}?expand=renderedFields,names,schema,transitions,operations,editmeta,changelog,versionedRepresentations`
      const issueResponse = await fetch(issueUrl, {
        method: 'GET',
        headers: {
          Accept: 'application/json',
          Authorization: `Bearer ${params.accessToken}`,
        },
      })

      if (!issueResponse.ok) {
        let message = `Failed to fetch Jira issue (${issueResponse.status})`
        try {
          const err = await issueResponse.json()
          message = err?.message || err?.errorMessages?.[0] || message
        } catch (_e) {}
        throw new Error(message)
      }

      return issueResponse.json()
    }

    const fetchSupplementary = async (cloudId: string, data: any) => {
      const base = `https://api.atlassian.com/ex/jira/${cloudId}/rest/api/3/issue/${params.issueKey}`
      const [commentsResp, worklogResp, watchersResp] = await Promise.all([
        fetch(`${base}/comment?maxResults=100&orderBy=-created`, {
          headers: { Accept: 'application/json', Authorization: `Bearer ${params.accessToken}` },
        }),
        fetch(`${base}/worklog?maxResults=100`, {
          headers: { Accept: 'application/json', Authorization: `Bearer ${params.accessToken}` },
        }),
        fetch(`${base}/watchers`, {
          headers: { Accept: 'application/json', Authorization: `Bearer ${params.accessToken}` },
        }),
      ])

      try {
        if (commentsResp.ok) {
          const commentsData = await commentsResp.json()
          if (data?.fields) data.fields.comment = commentsData?.comments || data.fields.comment
        }
      } catch {
        logger.debug?.('Failed to fetch comments')
      }

      try {
        if (worklogResp.ok) {
          const worklogData = await worklogResp.json()
          if (data?.fields) data.fields.worklog = worklogData || data.fields.worklog
        }
      } catch {
        logger.debug?.('Failed to fetch worklog')
      }

      try {
        if (watchersResp.ok) {
          const watchersData = await watchersResp.json()
          if (data?.fields) {
            data.fields.watches = watchersData
          }
        }
      } catch {
        logger.debug?.('Failed to fetch watchers')
      }
    }

    let data: any

    if (!params.cloudId) {
      const cloudId = await getJiraCloudId(params.domain, params.accessToken)
      data = await fetchIssue(cloudId)
      await fetchSupplementary(cloudId, data)
    } else {
      if (!response.ok) {
        let message = `Failed to fetch Jira issue (${response.status})`
        try {
          const err = await response.json()
          message = err?.message || err?.errorMessages?.[0] || message
        } catch (_e) {}
        throw new Error(message)
      }
      data = await response.json()
      await fetchSupplementary(params.cloudId, data)
    }

    return {
      success: true,
      output: {
        ts: new Date().toISOString(),
        ...transformIssueData(data),
        issue: data,
      },
    }
  },

  outputs: {
    ts: TIMESTAMP_OUTPUT,
    ...ISSUE_ITEM_PROPERTIES,
    issue: {
      type: 'json',
      description: 'Complete raw Jira issue object from the API',
      optional: true,
    },
  },
}
