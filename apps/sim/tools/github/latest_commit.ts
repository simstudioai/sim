import {
  COMMIT_DATA_OUTPUT,
  type LatestCommitParams,
  type LatestCommitResponse,
  USER_FULL_OUTPUT,
} from '@/tools/github/types'
import type { ToolConfig } from '@/tools/types'

export const latestCommitTool: ToolConfig<LatestCommitParams, LatestCommitResponse> = {
  id: 'github_latest_commit',
  name: 'GitHub Latest Commit',
  description: 'Retrieve the latest commit from a GitHub repository',
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
      required: false,
      visibility: 'user-or-llm',
      description: "Branch name (defaults to the repository's default branch)",
    },
    apiKey: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'GitHub API token',
    },
  },

  request: {
    url: '/api/tools/github/latest-commit',
    method: 'POST',
    headers: () => ({
      'Content-Type': 'application/json',
    }),
    body: (params) => ({
      owner: params.owner,
      repo: params.repo,
      branch: params.branch,
      apiKey: params.apiKey,
    }),
  },

  outputs: {
    content: { type: 'string', description: 'Human-readable commit summary' },
    metadata: {
      type: 'object',
      description: 'Commit metadata',
    },
  },
}

export const latestCommitV2Tool: ToolConfig = {
  id: 'github_latest_commit_v2',
  name: latestCommitTool.name,
  description: latestCommitTool.description,
  version: '2.0.0',
  params: latestCommitTool.params,
  request: latestCommitTool.request,
  oauth: latestCommitTool.oauth,
  transformResponse: async (response: Response) => {
    const data = await response.json()
    if (!response.ok) {
      throw new Error(data.error || 'Failed to fetch latest commit')
    }
    const metadata = data.output?.metadata ?? {}
    return {
      success: true,
      output: {
        sha: metadata.sha ?? '',
        html_url: metadata.html_url ?? '',
        commit: {
          message: metadata.commit_message ?? '',
          author: metadata.author ?? null,
          committer: metadata.committer ?? null,
        },
        author: metadata.author ?? null,
        committer: metadata.committer ?? null,
      },
    }
  },
  outputs: {
    sha: { type: 'string', description: 'Commit SHA' },
    html_url: { type: 'string', description: 'GitHub web URL' },
    commit: COMMIT_DATA_OUTPUT,
    author: USER_FULL_OUTPUT,
    committer: USER_FULL_OUTPUT,
  },
}
