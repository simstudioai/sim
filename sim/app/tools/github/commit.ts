import { ToolConfig } from '../types'
import { LatestCommitParams, LatestCommitResponse } from './types'

export const latestCommitTool: ToolConfig<LatestCommitParams, LatestCommitResponse> = {
  id: 'github_latest_commit',
  name: 'GitHub Latest Commit',
  description: 'Retrieve the latest commit from a GitHub repository',
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
    branch: {
      type: 'string',
      required: false,
      description: 'Branch name (defaults to the repository\'s default branch)',
    },
    apiKey: {
      type: 'string',
      required: true,
      requiredForToolCall: true,
      description: 'GitHub API token',
    },
  },

  request: {
    url: (params) => {
      const baseUrl = `https://api.github.com/repos/${params.owner}/${params.repo}`
      return params.branch 
        ? `${baseUrl}/commits/${params.branch}`
        : `${baseUrl}/commits/HEAD`
    },
    method: 'GET',
    headers: (params) => ({
      Accept: 'application/vnd.github.v3+json',
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
    const content = `Latest commit: "${data.commit.message}" by ${data.commit.author.name} on ${data.commit.author.date}. SHA: ${data.sha}`

    return {
      success: true,
      output: {
        content,
        metadata: {
          sha: data.sha,
          html_url: data.html_url,
          commit_message: data.commit.message,
          author: {
            name: data.commit.author.name,
            login: data.author?.login || 'Unknown',
            avatar_url: data.author?.avatar_url || '',
            html_url: data.author?.html_url || '',
          },
          committer: {
            name: data.commit.committer.name,
            login: data.committer?.login || 'Unknown',
            avatar_url: data.committer?.avatar_url || '',
            html_url: data.committer?.html_url || '',
          },
          stats: data.stats ? {
            additions: data.stats.additions,
            deletions: data.stats.deletions,
            total: data.stats.total,
          } : undefined,
        },
      },
    }
  },

  transformError: (error) => {
    if (error instanceof Error) {
      if (error.message.includes('404')) {
        return 'Commit or repository not found. Please check the owner, repository name, and branch.'
      }
      if (error.message.includes('401')) {
        return 'Authentication failed. Please check your GitHub token.'
      }
      return error.message
    }
    return 'Failed to fetch commit information'
  },
} 