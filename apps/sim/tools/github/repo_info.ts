import type { ToolConfig } from '../types'
import type { BaseGitHubParams, RepoInfoResponse } from './types'

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
    if (!response.ok) {
      throw new Error(`GitHub API error: ${response.statusText}`)
    }

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

  transformError: (error) => {
    if (error instanceof Error) {
      if (error.message.includes('404')) {
        return 'Repository not found. Please check the owner and repository name.'
      }
      if (error.message.includes('401')) {
        return 'Authentication failed. Please check your GitHub token.'
      }
      return error.message
    }
    return 'Failed to fetch repository information'
  },
}
