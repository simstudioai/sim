import type { ToolConfig } from '../types'
import type { CreateCommentParams, CreateCommentResponse } from './types'

export const commentTool: ToolConfig<CreateCommentParams, CreateCommentResponse> = {
  id: 'github_comment',
  name: 'GitHub PR Commenter',
  description: 'Create comments on GitHub PRs',
  version: '1.0.0',

  params: {
    owner: {
      type: 'string',
      required: true,
      description: 'Repository owner',
    },
    repo: {
      type: 'string',
      required: true,
      description: 'Repository name',
    },
    pullNumber: {
      type: 'number',
      required: true,
      description: 'Pull request number',
    },
    body: {
      type: 'string',
      required: true,
      description: 'Comment content',
    },
    path: {
      type: 'string',
      required: false,
      description: 'File path for review comment',
    },
    position: {
      type: 'number',
      required: false,
      description: 'Line number for review comment',
    },
    apiKey: {
      type: 'string',
      required: true,
      requiredForToolCall: true,
      description: 'GitHub API token',
    },
    commentType: {
      type: 'string',
      required: false,
      description: 'Type of comment (pr_comment or file_comment)',
    },
    line: {
      type: 'number',
      required: false,
      description: 'Line number for review comment',
    },
    side: {
      type: 'string',
      required: false,
      description: 'Side of the diff (LEFT or RIGHT)',
      default: 'RIGHT',
    },
    commitId: {
      type: 'string',
      required: false,
      description: 'The SHA of the commit to comment on',
    },
  },

  request: {
    url: (params) => {
      if (params.path) {
        return `https://api.github.com/repos/${params.owner}/${params.repo}/pulls/${params.pullNumber}/comments`
      }
      return `https://api.github.com/repos/${params.owner}/${params.repo}/pulls/${params.pullNumber}/reviews`
    },
    method: 'POST',
    headers: (params) => ({
      Accept: 'application/vnd.github.v3+json',
      Authorization: `Bearer ${params.apiKey}`,
      'X-GitHub-Api-Version': '2022-11-28',
    }),
    body: (params) => {
      if (params.commentType === 'file_comment') {
        return {
          body: params.body,
          commit_id: params.commitId,
          path: params.path,
          line: params.line || params.position,
          side: params.side || 'RIGHT',
        }
      }
      return {
        body: params.body,
        event: 'COMMENT',
      }
    },
  },

  transformResponse: async (response) => {
    const data = await response.json()

    // Create a human-readable content string
    const content = `Comment created: "${data.body}"`

    return {
      success: true,
      output: {
        content,
        metadata: {
          id: data.id,
          html_url: data.html_url,
          created_at: data.created_at,
          updated_at: data.updated_at,
          path: data.path,
          line: data.line || data.position,
          side: data.side,
          commit_id: data.commit_id,
        },
      },
    }
  },

  transformError: (error) => {
    return error instanceof Error ? error.message : 'Failed to create comment'
  },
}
