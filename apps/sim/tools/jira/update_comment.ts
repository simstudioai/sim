import type { JiraUpdateCommentParams, JiraUpdateCommentResponse } from '@/tools/jira/types'
import { getJiraCloudId } from '@/tools/jira/utils'
import type { ToolConfig } from '@/tools/types'

export const jiraUpdateCommentTool: ToolConfig<JiraUpdateCommentParams, JiraUpdateCommentResponse> =
  {
    id: 'jira_update_comment',
    name: 'Jira Update Comment',
    description: 'Update an existing comment on a Jira issue',
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
        description: 'ID of the comment to update',
      },
      body: {
        type: 'string',
        required: true,
        visibility: 'user-or-llm',
        description: 'Updated comment text',
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
      url: (params: JiraUpdateCommentParams) => {
        if (params.cloudId) {
          return `https://api.atlassian.com/ex/jira/${params.cloudId}/rest/api/3/issue/${params.issueKey}/comment/${params.commentId}`
        }
        return 'https://api.atlassian.com/oauth/token/accessible-resources'
      },
      method: (params: JiraUpdateCommentParams) => (params.cloudId ? 'PUT' : 'GET'),
      headers: (params: JiraUpdateCommentParams) => {
        return {
          Accept: 'application/json',
          'Content-Type': 'application/json',
          Authorization: `Bearer ${params.accessToken}`,
        }
      },
      body: (params: JiraUpdateCommentParams) => {
        if (!params.cloudId) return undefined as any
        return {
          body: {
            type: 'doc',
            version: 1,
            content: [
              {
                type: 'paragraph',
                content: [
                  {
                    type: 'text',
                    text: params.body,
                  },
                ],
              },
            ],
          },
        }
      },
    },

    transformResponse: async (response: Response, params?: JiraUpdateCommentParams) => {
      if (!params?.cloudId) {
        const cloudId = await getJiraCloudId(params!.domain, params!.accessToken)
        // Make the actual request with the resolved cloudId
        const commentUrl = `https://api.atlassian.com/ex/jira/${cloudId}/rest/api/3/issue/${params?.issueKey}/comment/${params?.commentId}`
        const commentResponse = await fetch(commentUrl, {
          method: 'PUT',
          headers: {
            Accept: 'application/json',
            'Content-Type': 'application/json',
            Authorization: `Bearer ${params?.accessToken}`,
          },
          body: JSON.stringify({
            body: {
              type: 'doc',
              version: 1,
              content: [
                {
                  type: 'paragraph',
                  content: [
                    {
                      type: 'text',
                      text: params?.body,
                    },
                  ],
                },
              ],
            },
          }),
        })

        if (!commentResponse.ok) {
          let message = `Failed to update comment on Jira issue (${commentResponse.status})`
          try {
            const err = await commentResponse.json()
            message = err?.errorMessages?.join(', ') || err?.message || message
          } catch (_e) {}
          throw new Error(message)
        }

        const data = await commentResponse.json()

        return {
          success: true,
          output: {
            ts: new Date().toISOString(),
            issueKey: params?.issueKey || 'unknown',
            commentId: data?.id || params?.commentId || 'unknown',
            body: params?.body || '',
            success: true,
          },
        }
      }

      // If cloudId was provided, process the response
      if (!response.ok) {
        let message = `Failed to update comment on Jira issue (${response.status})`
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
          commentId: data?.id || params?.commentId || 'unknown',
          body: params?.body || '',
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
        description:
          'Updated comment details with timestamp, issue key, comment ID, body text, and success status',
      },
    },
  }
