import type { MergePRParams, MergeResultResponse } from '@/tools/github/types'
import type { ToolConfig } from '@/tools/types'

export const mergePRTool: ToolConfig<MergePRParams, MergeResultResponse> = {
  id: 'github_merge_pr',
  name: 'GitHub Merge Pull Request',
  description: 'Merge a pull request in a GitHub repository',
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
    pullNumber: {
      type: 'number',
      required: true,
      visibility: 'user-or-llm',
      description: 'Pull request number',
    },
    commit_title: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Title for the merge commit',
    },
    commit_message: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Extra detail to append to merge commit message',
    },
    merge_method: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Merge method: merge, squash, or rebase',
      default: 'merge',
    },
    apiKey: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'GitHub API token',
    },
  },

  request: {
    url: (params) =>
      `https://api.github.com/repos/${params.owner}/${params.repo}/pulls/${params.pullNumber}/merge`,
    method: 'PUT',
    headers: (params) => ({
      Accept: 'application/vnd.github.v3+json',
      Authorization: `Bearer ${params.apiKey}`,
      'X-GitHub-Api-Version': '2022-11-28',
    }),
    body: (params) => {
      const body: Record<string, any> = {}
      if (params.commit_title !== undefined) body.commit_title = params.commit_title
      if (params.commit_message !== undefined) body.commit_message = params.commit_message
      if (params.merge_method !== undefined) body.merge_method = params.merge_method
      return body
    },
  },

  transformResponse: async (response) => {
    if (response.status === 405) {
      const error = await response.json()
      return {
        success: false,
        error: error.message || 'Pull request is not mergeable',
        output: {
          content: '',
          metadata: {
            sha: '',
            merged: false,
            message: error.message || 'Pull request is not mergeable',
          },
        },
      }
    }

    const result = await response.json()

    const content = `PR merged successfully!
SHA: ${result.sha}
Message: ${result.message}`

    return {
      success: true,
      output: {
        content,
        metadata: {
          sha: result.sha,
          merged: result.merged,
          message: result.message,
        },
      },
    }
  },

  outputs: {
    content: { type: 'string', description: 'Human-readable merge confirmation' },
    metadata: {
      type: 'object',
      description: 'Merge result metadata',
      properties: {
        sha: { type: 'string', description: 'Merge commit SHA' },
        merged: { type: 'boolean', description: 'Whether merge was successful' },
        message: { type: 'string', description: 'Response message' },
      },
    },
  },
}
