import type { JiraUpdateCommentParams, JiraUpdateCommentResponse } from '@/tools/jira/types'
import { SUCCESS_OUTPUT, TIMESTAMP_OUTPUT, USER_OUTPUT_PROPERTIES } from '@/tools/jira/types'
import { extractAdfText, getJiraCloudId, transformUser } from '@/tools/jira/utils'
import type { ToolConfig } from '@/tools/types'

/**
 * Transforms an update comment API response into typed output.
 */
function transformUpdateCommentResponse(data: any, params: JiraUpdateCommentParams) {
  return {
    ts: new Date().toISOString(),
    issueKey: params.issueKey ?? 'unknown',
    commentId: data?.id ?? params.commentId ?? 'unknown',
    body: data?.body ? (extractAdfText(data.body) ?? params.body ?? '') : (params.body ?? ''),
    author: transformUser(data?.author) ?? { accountId: '', displayName: '' },
    created: data?.created ?? '',
    updated: data?.updated ?? '',
    success: true,
  }
}

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
      visibility: {
        type: 'json',
        required: false,
        visibility: 'user-or-llm',
        description:
          'Restrict comment visibility. Object with "type" ("role" or "group") and "value" (role/group name).',
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
        const payload: Record<string, any> = {
          body: {
            type: 'doc',
            version: 1,
            content: [
              {
                type: 'paragraph',
                content: [{ type: 'text', text: params.body }],
              },
            ],
          },
        }
        if (params.visibility) payload.visibility = params.visibility
        return payload
      },
    },

    transformResponse: async (response: Response, params?: JiraUpdateCommentParams) => {
      const payload: Record<string, any> = {
        body: {
          type: 'doc',
          version: 1,
          content: [
            {
              type: 'paragraph',
              content: [{ type: 'text', text: params?.body ?? '' }],
            },
          ],
        },
      }
      if (params?.visibility) payload.visibility = params.visibility

      const makeRequest = async (cloudId: string) => {
        const commentUrl = `https://api.atlassian.com/ex/jira/${cloudId}/rest/api/3/issue/${params!.issueKey}/comment/${params!.commentId}`
        const commentResponse = await fetch(commentUrl, {
          method: 'PUT',
          headers: {
            Accept: 'application/json',
            'Content-Type': 'application/json',
            Authorization: `Bearer ${params!.accessToken}`,
          },
          body: JSON.stringify(payload),
        })

        if (!commentResponse.ok) {
          let message = `Failed to update comment on Jira issue (${commentResponse.status})`
          try {
            const err = await commentResponse.json()
            message = err?.errorMessages?.join(', ') || err?.message || message
          } catch (_e) {}
          throw new Error(message)
        }

        return commentResponse.json()
      }

      let data: any

      if (!params?.cloudId) {
        const cloudId = await getJiraCloudId(params!.domain, params!.accessToken)
        data = await makeRequest(cloudId)
      } else {
        if (!response.ok) {
          let message = `Failed to update comment on Jira issue (${response.status})`
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
        output: transformUpdateCommentResponse(data, params!),
      }
    },

    outputs: {
      ts: TIMESTAMP_OUTPUT,
      success: SUCCESS_OUTPUT,
      issueKey: { type: 'string', description: 'Issue key' },
      commentId: { type: 'string', description: 'Updated comment ID' },
      body: { type: 'string', description: 'Updated comment text' },
      author: {
        type: 'object',
        description: 'Comment author',
        properties: USER_OUTPUT_PROPERTIES,
      },
      created: { type: 'string', description: 'ISO 8601 timestamp when the comment was created' },
      updated: {
        type: 'string',
        description: 'ISO 8601 timestamp when the comment was last updated',
      },
    },
  }
