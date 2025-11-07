import type { DeleteBranchParams, DeleteBranchResponse } from '@/tools/github/types'
import type { ToolConfig } from '@/tools/types'

export const deleteBranchTool: ToolConfig<DeleteBranchParams, DeleteBranchResponse> = {
  id: 'github_delete_branch',
  name: 'GitHub Delete Branch',
  description:
    'Delete a branch from a GitHub repository by removing its git reference. Protected branches cannot be deleted.',
  version: '1.0.0',

  params: {
    owner: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Repository owner (user or organization)',
    },
    repo: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Repository name',
    },
    branch: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Name of the branch to delete',
    },
    apiKey: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'GitHub Personal Access Token',
    },
  },

  request: {
    url: (params) =>
      `https://api.github.com/repos/${params.owner}/${params.repo}/git/refs/heads/${params.branch}`,
    method: 'DELETE',
    headers: (params) => ({
      Accept: 'application/vnd.github+json',
      Authorization: `Bearer ${params.apiKey}`,
      'X-GitHub-Api-Version': '2022-11-28',
    }),
  },

  transformResponse: async (response, params) => {
    if (!params) {
      return {
        success: false,
        error: 'Missing parameters',
        output: {
          content: '',
          metadata: {
            deleted: false,
            branch: '',
          },
        },
      }
    }

    const content = `Branch "${params.branch}" has been successfully deleted from ${params.owner}/${params.repo}`

    return {
      success: true,
      output: {
        content,
        metadata: {
          deleted: true,
          branch: params.branch,
        },
      },
    }
  },

  outputs: {
    content: { type: 'string', description: 'Human-readable deletion confirmation' },
    metadata: {
      type: 'object',
      description: 'Deletion metadata',
      properties: {
        deleted: { type: 'boolean', description: 'Whether the branch was deleted' },
        branch: { type: 'string', description: 'Name of the deleted branch' },
      },
    },
  },
}
