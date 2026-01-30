import {
  COMMIT_DATA_OUTPUT,
  COMMIT_PARENT_OUTPUT_PROPERTIES,
  COMMIT_SUMMARY_OUTPUT_PROPERTIES,
  USER_FULL_OUTPUT,
} from '@/tools/github/types'
import type { ToolConfig } from '@/tools/types'

interface ListCommitsParams {
  owner: string
  repo: string
  sha?: string
  path?: string
  author?: string
  committer?: string
  since?: string
  until?: string
  per_page?: number
  page?: number
  apiKey: string
}

interface ListCommitsResponse {
  success: boolean
  output: {
    content: string
    metadata: {
      commits: Array<{
        sha: string
        html_url: string
        message: string
        author: { name: string; email: string; date: string; login?: string }
        committer: { name: string; email: string; date: string; login?: string }
      }>
      count: number
    }
  }
}

export const listCommitsTool: ToolConfig<ListCommitsParams, ListCommitsResponse> = {
  id: 'github_list_commits',
  name: 'GitHub List Commits',
  description:
    'List commits in a repository with optional filtering by SHA, path, author, committer, or date range',
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
    sha: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'SHA or branch to start listing commits from',
    },
    path: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Only commits containing this file path',
    },
    author: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'GitHub login or email address to filter by author',
    },
    committer: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'GitHub login or email address to filter by committer',
    },
    since: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Only commits after this date (ISO 8601 format)',
    },
    until: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Only commits before this date (ISO 8601 format)',
    },
    per_page: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Results per page (max 100, default: 30)',
      default: 30,
    },
    page: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Page number (default: 1)',
      default: 1,
    },
    apiKey: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'GitHub API token',
    },
  },

  request: {
    url: (params) => {
      const url = new URL(`https://api.github.com/repos/${params.owner}/${params.repo}/commits`)
      if (params.sha) url.searchParams.append('sha', params.sha)
      if (params.path) url.searchParams.append('path', params.path)
      if (params.author) url.searchParams.append('author', params.author)
      if (params.committer) url.searchParams.append('committer', params.committer)
      if (params.since) url.searchParams.append('since', params.since)
      if (params.until) url.searchParams.append('until', params.until)
      if (params.per_page) url.searchParams.append('per_page', String(params.per_page))
      if (params.page) url.searchParams.append('page', String(params.page))
      return url.toString()
    },
    method: 'GET',
    headers: (params) => ({
      Accept: 'application/vnd.github.v3+json',
      Authorization: `Bearer ${params.apiKey}`,
      'X-GitHub-Api-Version': '2022-11-28',
    }),
  },

  transformResponse: async (response) => {
    const data = await response.json()

    const commits = data.map((item: any) => ({
      sha: item.sha,
      html_url: item.html_url,
      message: item.commit.message,
      author: {
        name: item.commit.author.name,
        email: item.commit.author.email,
        date: item.commit.author.date,
        login: item.author?.login,
      },
      committer: {
        name: item.commit.committer.name,
        email: item.commit.committer.email,
        date: item.commit.committer.date,
        login: item.committer?.login,
      },
    }))

    const content = `Found ${commits.length} commit(s):
${commits
  .map(
    (c: any) =>
      `${c.sha.substring(0, 7)} - ${c.message.split('\n')[0]}
  Author: ${c.author.login ?? c.author.name} (${c.author.date})
  ${c.html_url}`
  )
  .join('\n\n')}`

    return {
      success: true,
      output: {
        content,
        metadata: {
          commits,
          count: commits.length,
        },
      },
    }
  },

  outputs: {
    content: { type: 'string', description: 'Human-readable commit list' },
    metadata: {
      type: 'object',
      description: 'Commits metadata',
      properties: {
        commits: {
          type: 'array',
          description: 'Array of commits',
          items: {
            type: 'object',
            properties: {
              sha: { type: 'string', description: 'Commit SHA' },
              html_url: { type: 'string', description: 'GitHub web URL' },
              message: { type: 'string', description: 'Commit message' },
              author: { type: 'object', description: 'Author info' },
              committer: { type: 'object', description: 'Committer info' },
            },
          },
        },
        count: { type: 'number', description: 'Number of commits returned' },
      },
    },
  },
}

export const listCommitsV2Tool: ToolConfig<ListCommitsParams, any> = {
  id: 'github_list_commits_v2',
  name: listCommitsTool.name,
  description: listCommitsTool.description,
  version: '2.0.0',
  params: listCommitsTool.params,
  request: listCommitsTool.request,

  transformResponse: async (response: Response) => {
    const data = await response.json()
    return {
      success: true,
      output: {
        items: data.map((item: any) => ({
          ...item,
          author: item.author ?? null,
          committer: item.committer ?? null,
        })),
        count: data.length,
      },
    }
  },

  outputs: {
    items: {
      type: 'array',
      description: 'Array of commit objects from GitHub API',
      items: {
        type: 'object',
        properties: {
          ...COMMIT_SUMMARY_OUTPUT_PROPERTIES,
          commit: COMMIT_DATA_OUTPUT,
          author: USER_FULL_OUTPUT,
          committer: USER_FULL_OUTPUT,
          parents: {
            type: 'array',
            description: 'Parent commits',
            items: {
              type: 'object',
              properties: COMMIT_PARENT_OUTPUT_PROPERTIES,
            },
          },
        },
      },
    },
    count: { type: 'number', description: 'Number of commits returned' },
  },
}
