import { getJiraCloudId } from '@/tools/jira/utils'
import type { ToolConfig, ToolResponse } from '@/tools/types'

export interface JiraGetCommentsParams {
  accessToken: string
  domain: string
  issueKey: string
  startAt?: number
  maxResults?: number
  cloudId?: string
}

export interface JiraGetCommentsResponse extends ToolResponse {
  output: {
    ts: string
    issueKey: string
    total: number
    comments: Array<{
      id: string
      author: string
      body: string
      created: string
      updated: string
    }>
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
        const startAt = params.startAt || 0
        const maxResults = params.maxResults || 50
        return `https://api.atlassian.com/ex/jira/${params.cloudId}/rest/api/3/issue/${params.issueKey}/comment?startAt=${startAt}&maxResults=${maxResults}`
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
    // Extract text from Atlassian Document Format
    const extractText = (content: any): string => {
      if (!content) return ''
      if (typeof content === 'string') return content
      if (Array.isArray(content)) {
        return content.map(extractText).join(' ')
      }
      if (content.type === 'text') return content.text || ''
      if (content.content) return extractText(content.content)
      return ''
    }

    if (!params?.cloudId) {
      const cloudId = await getJiraCloudId(params!.domain, params!.accessToken)
      // Make the actual request with the resolved cloudId
      const startAt = params?.startAt || 0
      const maxResults = params?.maxResults || 50
      const commentsUrl = `https://api.atlassian.com/ex/jira/${cloudId}/rest/api/3/issue/${params?.issueKey}/comment?startAt=${startAt}&maxResults=${maxResults}`
      const commentsResponse = await fetch(commentsUrl, {
        method: 'GET',
        headers: {
          Accept: 'application/json',
          Authorization: `Bearer ${params?.accessToken}`,
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

      const data = await commentsResponse.json()

      return {
        success: true,
        output: {
          ts: new Date().toISOString(),
          issueKey: params?.issueKey || 'unknown',
          total: data.total || 0,
          comments: (data.comments || []).map((comment: any) => ({
            id: comment.id,
            author: comment.author?.displayName || comment.author?.accountId || 'Unknown',
            body: extractText(comment.body),
            created: comment.created,
            updated: comment.updated,
          })),
        },
      }
    }

    // If cloudId was provided, process the response
    if (!response.ok) {
      let message = `Failed to get comments from Jira issue (${response.status})`
      try {
        const err = await response.json()
        message = err?.errorMessages?.join(', ') || err?.message || message
      } catch (_e) {}
      throw new Error(message)
    }

    const data = await response.json()

    return {
      success: true,
      output: {
        ts: new Date().toISOString(),
        issueKey: params?.issueKey || 'unknown',
        total: data.total || 0,
        comments: (data.comments || []).map((comment: any) => ({
          id: comment.id,
          author: comment.author?.displayName || comment.author?.accountId || 'Unknown',
          body: extractText(comment.body),
          created: comment.created,
          updated: comment.updated,
        })),
      },
    }
  },

  outputs: {
    success: {
      type: 'boolean',
      description: 'Operation success status',
    },
    output: {
      type: 'object',
      description: 'Comments data with timestamp, issue key, total count, and array of comments',
    },
  },
}
