import { getJiraCloudId } from '@/tools/jira/utils'
import type { ToolConfig, ToolResponse } from '@/tools/types'

export interface JiraDeleteCommentParams {
  accessToken: string
  domain: string
  issueKey: string
  commentId: string
  cloudId?: string
}

export interface JiraDeleteCommentResponse extends ToolResponse {
  output: {
    ts: string
    issueKey: string
    commentId: string
    success: boolean
  }
}

export const jiraDeleteCommentTool: ToolConfig<JiraDeleteCommentParams, JiraDeleteCommentResponse> =
  {
    id: 'jira_delete_comment',
    name: 'Jira Delete Comment',
    description: 'Delete a comment from a Jira issue',
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
        description: 'Jira issue key containing the comment (e.g., PROJ-123)',
      },
      commentId: {
        type: 'string',
        required: true,
        visibility: 'user-or-llm',
        description: 'ID of the comment to delete',
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
      url: (params: JiraDeleteCommentParams) => {
        if (params.cloudId) {
          return `https://api.atlassian.com/ex/jira/${params.cloudId}/rest/api/3/issue/${params.issueKey}/comment/${params.commentId}`
        }
        return 'https://api.atlassian.com/oauth/token/accessible-resources'
      },
      method: (params: JiraDeleteCommentParams) => (params.cloudId ? 'DELETE' : 'GET'),
      headers: (params: JiraDeleteCommentParams) => {
        return {
          Accept: 'application/json',
          Authorization: `Bearer ${params.accessToken}`,
        }
      },
    },

    transformResponse: async (response: Response, params?: JiraDeleteCommentParams) => {
      if (!params?.cloudId) {
        const cloudId = await getJiraCloudId(params!.domain, params!.accessToken)
        // Make the actual request with the resolved cloudId
        const commentUrl = `https://api.atlassian.com/ex/jira/${cloudId}/rest/api/3/issue/${params?.issueKey}/comment/${params?.commentId}`
        const commentResponse = await fetch(commentUrl, {
          method: 'DELETE',
          headers: {
            Accept: 'application/json',
            Authorization: `Bearer ${params?.accessToken}`,
          },
        })

        if (!commentResponse.ok) {
          let message = `Failed to delete comment from Jira issue (${commentResponse.status})`
          try {
            const err = await commentResponse.json()
            message = err?.errorMessages?.join(', ') || err?.message || message
          } catch (_e) {}
          throw new Error(message)
        }

        return {
          success: true,
          output: {
            ts: new Date().toISOString(),
            issueKey: params?.issueKey || 'unknown',
            commentId: params?.commentId || 'unknown',
            success: true,
          },
        }
      }

      // If cloudId was provided, process the response
      if (!response.ok) {
        let message = `Failed to delete comment from Jira issue (${response.status})`
        try {
          const err = await response.json()
          message = err?.errorMessages?.join(', ') || err?.message || message
        } catch (_e) {}
        throw new Error(message)
      }

      return {
        success: true,
        output: {
          ts: new Date().toISOString(),
          issueKey: params?.issueKey || 'unknown',
          commentId: params?.commentId || 'unknown',
          success: true,
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
        description: 'Deletion details with timestamp, issue key, comment ID, and success status',
      },
    },
  }
