import type { GreptileStatusParams, GreptileStatusResponse } from '@/tools/greptile/types'
import type { ToolConfig } from '@/tools/types'

export const statusTool: ToolConfig<GreptileStatusParams, GreptileStatusResponse> = {
  id: 'greptile_status',
  name: 'Greptile Repository Status',
  description:
    'Check the indexing status of a repository. Use this to verify if a repository is ready to be queried or to monitor indexing progress.',
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
      description: 'Branch name (e.g., "main" or "master")',
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
    url: (params) => {
      // Repository ID format: remote:branch:owner/repo (URL encoded)
      const repositoryId = `${params.remote}:${params.branch}:${params.repository}`
      return `https://api.greptile.com/v2/repositories/${encodeURIComponent(repositoryId)}`
    },
    method: 'GET',
    headers: (params) => ({
      'Content-Type': 'application/json',
      Authorization: `Bearer ${params.apiKey}`,
      'X-Github-Token': params.githubToken,
    }),
  },

  transformResponse: async (response: Response) => {
    const data = await response.json()

    return {
      success: true,
      output: {
        repository: data.repository || '',
        remote: data.remote || '',
        branch: data.branch || '',
        private: data.private || false,
        status: data.status || 'unknown',
        filesProcessed: data.filesProcessed,
        numFiles: data.numFiles,
        sampleQuestions: data.sampleQuestions || [],
        sha: data.sha,
      },
    }
  },

  outputs: {
    repository: {
      type: 'string',
      description: 'Repository name (owner/repo)',
    },
    remote: {
      type: 'string',
      description: 'Git remote (github/gitlab)',
    },
    branch: {
      type: 'string',
      description: 'Branch name',
    },
    private: {
      type: 'boolean',
      description: 'Whether the repository is private',
    },
    status: {
      type: 'string',
      description: 'Indexing status: submitted, cloning, processing, completed, or failed',
    },
    filesProcessed: {
      type: 'number',
      description: 'Number of files processed so far',
    },
    numFiles: {
      type: 'number',
      description: 'Total number of files in the repository',
    },
    sampleQuestions: {
      type: 'array',
      description: 'Sample questions for the indexed repository',
    },
    sha: {
      type: 'string',
      description: 'Git commit SHA of the indexed version',
    },
  },
}
