import type { CreateBranchParams, RefResponse } from '@/tools/github/types'
import type { ToolConfig } from '@/tools/types'

export const createBranchTool: ToolConfig<CreateBranchParams, RefResponse> = {
  id: 'github_create_branch',
  name: 'GitHub Create Branch',
  description:
    'Create a new branch in a GitHub repository by creating a git reference pointing to a specific commit SHA.',
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
      description: 'Name of the branch to create',
    },
    sha: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Commit SHA to point the branch to',
    },
    apiKey: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'GitHub Personal Access Token',
    },
  },

  request: {
    url: (params) => `https://api.github.com/repos/${params.owner}/${params.repo}/git/refs`,
    method: 'POST',
    headers: (params) => ({
      Accept: 'application/vnd.github+json',
      Authorization: `Bearer ${params.apiKey}`,
      'X-GitHub-Api-Version': '2022-11-28',
      'Content-Type': 'application/json',
    }),
    body: (params) => ({
      ref: `refs/heads/${params.branch}`,
      sha: params.sha,
    }),
  },

  transformResponse: async (response) => {
    const ref = await response.json()

    // Create a human-readable content string
    const content = `Branch created successfully:
Branch: ${ref.ref.replace('refs/heads/', '')}
SHA: ${ref.object.sha}
URL: ${ref.url}`

    return {
      success: true,
      output: {
        content,
        metadata: {
          ref: ref.ref,
          url: ref.url,
          sha: ref.object.sha,
        },
      },
    }
  },

  outputs: {
    content: { type: 'string', description: 'Human-readable branch creation confirmation' },
    metadata: {
      type: 'object',
      description: 'Git reference metadata',
      properties: {
        ref: { type: 'string', description: 'Full reference name (refs/heads/branch)' },
        url: { type: 'string', description: 'API URL for the reference' },
        sha: { type: 'string', description: 'Commit SHA the branch points to' },
      },
    },
  },
}
