import type { BaseGitHubParams, RepoInfoResponse } from '@/tools/github/types'
import type { ToolConfig } from '@/tools/types'

export const repoInfoTool: ToolConfig<BaseGitHubParams, RepoInfoResponse> = {
  id: 'github_repo_info',
  name: 'GitHub Repository Info',
  description:
    'Retrieve comprehensive GitHub repository metadata including stars, forks, issues, and primary language. Supports both public and private repositories with optional authentication.',
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
    apiKey: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'GitHub Personal Access Token',
    },
  },

  request: {
    url: (params) => `https://api.github.com/repos/${params.owner}/${params.repo}`,
    method: 'GET',
    headers: (params) => ({
      Accept: 'application/vnd.github+json',
      Authorization: `Bearer ${params.apiKey}`,
      'X-GitHub-Api-Version': '2022-11-28',
    }),
  },

  transformResponse: async (response) => {
    const data = await response.json()

    // Create a human-readable content string
    const content = `Repository: ${data.name}
Description: ${data.description || 'No description'}
Language: ${data.language || 'Not specified'}
Stars: ${data.stargazers_count}
Forks: ${data.forks_count}
Open Issues: ${data.open_issues_count}
URL: ${data.html_url}`

    return {
      success: true,
      output: {
        content,
        metadata: {
          name: data.name,
          description: data.description || '',
          stars: data.stargazers_count,
          forks: data.forks_count,
          openIssues: data.open_issues_count,
          language: data.language || 'Not specified',
        },
      },
    }
  },

  outputs: {
    content: { type: 'string', description: 'Human-readable repository summary' },
    metadata: {
      type: 'object',
      description: 'Repository metadata',
      properties: {
        name: { type: 'string', description: 'Repository name' },
        description: { type: 'string', description: 'Repository description' },
        stars: { type: 'number', description: 'Number of stars' },
        forks: { type: 'number', description: 'Number of forks' },
        openIssues: { type: 'number', description: 'Number of open issues' },
        language: { type: 'string', description: 'Primary programming language' },
      },
    },
  },
}
