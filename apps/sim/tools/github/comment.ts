import type { CreateCommentParams, CreateCommentResponse } from '@/tools/github/types'
import { COMMENT_OUTPUT_PROPERTIES, USER_OUTPUT } from '@/tools/github/types'
import type { ToolConfig } from '@/tools/types'

export const commentTool: ToolConfig<CreateCommentParams, CreateCommentResponse> = {
  id: 'github_comment',
  name: 'GitHub PR Commenter',
  description: 'Create comments on GitHub PRs',
  version: '1.0.0',

  params: {
    owner: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Repository owner',
    },
    repo: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Repository name',
    },
    body: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Comment content',
    },
    pullNumber: {
      type: 'number',
      required: true,
      visibility: 'user-or-llm',
      description: 'Pull request number',
    },
    path: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'File path for review comment',
    },
    position: {
      type: 'number',
      required: false,
      visibility: 'hidden',
      description: 'Line number for review comment',
    },
    commentType: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Type of comment (pr_comment or file_comment)',
    },
    line: {
      type: 'number',
      required: false,
      visibility: 'hidden',
      description: 'Line number for review comment',
    },
    side: {
      type: 'string',
      required: false,
      visibility: 'hidden',
      description: 'Side of the diff (LEFT or RIGHT)',
      default: 'RIGHT',
    },
    commitId: {
      type: 'string',
      required: false,
      visibility: 'hidden',
      description: 'The SHA of the commit to comment on',
    },
    apiKey: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'GitHub API token',
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

  outputs: {
    content: { type: 'string', description: 'Human-readable comment confirmation' },
    metadata: {
      type: 'object',
      description: 'Comment metadata',
    },
  },
}

export const commentV2Tool: ToolConfig = {
  id: 'github_comment_v2',
  name: commentTool.name,
  description: commentTool.description,
  version: '2.0.0',
  params: commentTool.params,
  request: commentTool.request,
  transformResponse: async (response: Response) => {
    const data = await response.json()
    return {
      success: true,
      output: {
        id: data.id,
        body: data.body,
        html_url: data.html_url,
        user: data.user,
        path: data.path ?? null,
        line: data.line ?? data.position ?? null,
        side: data.side ?? null,
        commit_id: data.commit_id ?? null,
        created_at: data.created_at,
        updated_at: data.updated_at,
      },
    }
  },
  outputs: {
    ...COMMENT_OUTPUT_PROPERTIES,
    user: USER_OUTPUT,
    path: { type: 'string', description: 'File path (if file comment)', optional: true },
    line: { type: 'number', description: 'Line number', optional: true },
    side: { type: 'string', description: 'Diff side', optional: true },
    commit_id: { type: 'string', description: 'Commit ID', optional: true },
  },
}
