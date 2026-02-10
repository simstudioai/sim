import type { JiraGetCommentsParams, JiraGetCommentsResponse } from '@/tools/jira/types'
import { COMMENT_ITEM_PROPERTIES, TIMESTAMP_OUTPUT } from '@/tools/jira/types'
import { extractAdfText, getJiraCloudId, transformUser } from '@/tools/jira/utils'
import type { ToolConfig } from '@/tools/types'

/**
 * Transforms a raw Jira comment object into typed output.
 */
function transformComment(comment: any) {
  return {
    id: comment.id ?? '',
    body: extractAdfText(comment.body) ?? '',
    author: transformUser(comment.author) ?? { accountId: '', displayName: '' },
    updateAuthor: transformUser(comment.updateAuthor),
    created: comment.created ?? '',
    updated: comment.updated ?? '',
    visibility: comment.visibility
      ? { type: comment.visibility.type ?? '', value: comment.visibility.value ?? '' }
      : null,
  }
}

export const jiraGetCommentsTool: ToolConfig<JiraGetCommentsParams, JiraGetCommentsResponse> = {
  id: 'jira_get_comments',
  name: 'Jira Get Comments',
  description: 'Get all comments from a Jira issue',
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
      description: 'Jira issue key to get comments from (e.g., PROJ-123)',
    },
    startAt: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Index of the first comment to return (default: 0)',
    },
    maxResults: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Maximum number of comments to return (default: 50)',
    },
    orderBy: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Sort order for comments: "-created" for newest first, "created" for oldest first',
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
    url: (params: JiraGetCommentsParams) => {
      if (params.cloudId) {
        const startAt = params.startAt ?? 0
        const maxResults = params.maxResults ?? 50
        const orderBy = params.orderBy ?? '-created'
        return `https://api.atlassian.com/ex/jira/${params.cloudId}/rest/api/3/issue/${params.issueKey}/comment?startAt=${startAt}&maxResults=${maxResults}&orderBy=${orderBy}`
      }
      return 'https://api.atlassian.com/oauth/token/accessible-resources'
    },
    method: 'GET',
    headers: (params: JiraGetCommentsParams) => {
      return {
        Accept: 'application/json',
        Authorization: `Bearer ${params.accessToken}`,
      }
    },
  },

  transformResponse: async (response: Response, params?: JiraGetCommentsParams) => {
    const fetchComments = async (cloudId: string) => {
      const startAt = params?.startAt ?? 0
      const maxResults = params?.maxResults ?? 50
      const orderBy = params?.orderBy ?? '-created'
      const commentsUrl = `https://api.atlassian.com/ex/jira/${cloudId}/rest/api/3/issue/${params!.issueKey}/comment?startAt=${startAt}&maxResults=${maxResults}&orderBy=${orderBy}`
      const commentsResponse = await fetch(commentsUrl, {
        method: 'GET',
        headers: {
          Accept: 'application/json',
          Authorization: `Bearer ${params!.accessToken}`,
        },
      })

      if (!commentsResponse.ok) {
        let message = `Failed to get comments from Jira issue (${commentsResponse.status})`
        try {
          const err = await commentsResponse.json()
          message = err?.errorMessages?.join(', ') || err?.message || message
        } catch (_e) {}
        throw new Error(message)
      }

      return commentsResponse.json()
    }

    let data: any

    if (!params?.cloudId) {
      const cloudId = await getJiraCloudId(params!.domain, params!.accessToken)
      data = await fetchComments(cloudId)
    } else {
      if (!response.ok) {
        let message = `Failed to get comments from Jira issue (${response.status})`
        try {
          const err = await response.json()
          message = err?.errorMessages?.join(', ') || err?.message || message
        } catch (_e) {}
        throw new Error(message)
      }
      data = await response.json()
    }

    return {
      success: true,
      output: {
        ts: new Date().toISOString(),
        issueKey: params?.issueKey ?? 'unknown',
        total: data.total ?? 0,
        startAt: data.startAt ?? 0,
        maxResults: data.maxResults ?? 0,
        comments: (data.comments ?? []).map(transformComment),
      },
    }
  },

  outputs: {
    ts: TIMESTAMP_OUTPUT,
    issueKey: { type: 'string', description: 'Issue key' },
    total: { type: 'number', description: 'Total number of comments' },
    startAt: { type: 'number', description: 'Pagination start index' },
    maxResults: { type: 'number', description: 'Maximum results per page' },
    comments: {
      type: 'array',
      description: 'Array of comments',
      items: {
        type: 'object',
        properties: COMMENT_ITEM_PROPERTIES,
      },
    },
  },
}
