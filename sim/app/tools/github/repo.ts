import { ToolConfig, ToolResponse } from '../types'

export interface RepoInfoParams {
  owner: string
  repo: string
  apiKey?: string
}

export interface RepoInfoResponse extends ToolResponse {
  output: {
    name: string
    description: string
    stars: number
    forks: number
    openIssues: number
    language: string
  }
}

export const repoInfoTool: ToolConfig<RepoInfoParams, RepoInfoResponse> = {
  id: 'github_repoinfo',
  name: 'GitHub Repository Info',
  description:
    'Retrieve comprehensive GitHub repository metadata including stars, forks, issues, and primary language. Supports both public and private repositories with optional authentication.',
  version: '1.0.0',

  params: {
    owner: {
      type: 'string',
      required: true,
      description: 'Repository owner (user or organization)',
    },
    repo: {
      type: 'string',
      required: true,
      description: 'Repository name',
    },
    apiKey: {
      type: 'string',
      requiredForToolCall: true,
      description: 'GitHub Personal Access Token',
    },
  },

  request: {
    url: (params: RepoInfoParams) => `https://api.github.com/repos/${params.owner}/${params.repo}`,
    method: 'GET',
    headers: (params: RepoInfoParams) => ({
      Accept: 'application/vnd.github+json',
      Authorization: params.apiKey ? `Bearer ${params.apiKey}` : '',
      'X-GitHub-Api-Version': '2022-11-28',
    }),
  },

  transformResponse: async (response: Response) => {
    if (!response.ok) {
      throw new Error(`GitHub API error: ${response.statusText}`)
    }

    const data = await response.json()

    return {
      success: true,
      output: {
        name: data.name,
        description: data.description || '',
        stars: data.stargazers_count,
        forks: data.forks_count,
        openIssues: data.open_issues_count,
        language: data.language || 'Not specified',
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
