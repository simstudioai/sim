import type { GreptileIndexParams, GreptileIndexResponse } from '@/tools/greptile/types'
import type { ToolConfig } from '@/tools/types'

export const indexRepoTool: ToolConfig<GreptileIndexParams, GreptileIndexResponse> = {
  id: 'greptile_index_repo',
  name: 'Greptile Index Repository',
  description:
    'Submit a repository to be indexed by Greptile. Indexing must complete before the repository can be queried. Small repos take 3-5 minutes, larger ones can take over an hour.',
  version: '1.0.0',

  params: {
    remote: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'Git remote type: github or gitlab',
    },
    repository: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Repository in owner/repo format. Example: "facebook/react" or "vercel/next.js"',
    },
    branch: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'Branch to index (e.g., "main" or "master")',
    },
    reload: {
      type: 'boolean',
      required: false,
      visibility: 'user-only',
      description: 'Force re-indexing even if already indexed',
    },
    notify: {
      type: 'boolean',
      required: false,
      visibility: 'user-only',
      description: 'Send email notification when indexing completes',
    },
    apiKey: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'Greptile API key',
    },
    githubToken: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'GitHub Personal Access Token with repo read access',
    },
  },

  request: {
    url: 'https://api.greptile.com/v2/repositories',
    method: 'POST',
    headers: (params) => ({
      'Content-Type': 'application/json',
      Authorization: `Bearer ${params.apiKey}`,
      'X-Github-Token': params.githubToken,
    }),
    body: (params) => {
      const body: Record<string, unknown> = {
        remote: params.remote,
        repository: params.repository,
        branch: params.branch,
      }

      if (params.reload != null) {
        body.reload = params.reload
      }

      if (params.notify != null) {
        body.notify = params.notify
      }

      return body
    },
  },

  transformResponse: async (response: Response, params) => {
    const data = await response.json()

    let repositoryId = ''
    if (data.statusEndpoint) {
      const match = data.statusEndpoint.match(/\/repositories\/(.+)$/)
      if (match) {
        repositoryId = decodeURIComponent(match[1])
      }
    }

    if (!repositoryId && params) {
      repositoryId = `${params.remote}:${params.branch}:${params.repository}`
    }

    return {
      success: true,
      output: {
        repositoryId,
        statusEndpoint: data.statusEndpoint || '',
        message: data.message || 'Repository submitted for indexing',
      },
    }
  },

  outputs: {
    repositoryId: {
      type: 'string',
      description:
        'Unique identifier for the indexed repository (format: remote:branch:owner/repo)',
    },
    statusEndpoint: {
      type: 'string',
      description: 'URL endpoint to check indexing status',
    },
    message: {
      type: 'string',
      description: 'Status message about the indexing operation',
    },
  },
}
