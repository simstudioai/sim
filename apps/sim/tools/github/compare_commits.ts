import {
  COMMIT_DATA_OUTPUT,
  COMMIT_FILE_OUTPUT_PROPERTIES,
  USER_FULL_OUTPUT,
} from '@/tools/github/types'
import type { ToolConfig } from '@/tools/types'

interface CompareCommitsParams {
  owner: string
  repo: string
  base: string
  head: string
  per_page?: number
  page?: number
  apiKey: string
}

interface CompareCommitsResponse {
  success: boolean
  output: {
    content: string
    metadata: {
      status: string
      ahead_by: number
      behind_by: number
      total_commits: number
      html_url: string
      diff_url: string
      patch_url: string
      base_commit: { sha: string; html_url: string }
      merge_base_commit: { sha: string; html_url: string }
      commits: Array<{
        sha: string
        html_url: string
        message: string
        author: { login?: string; name: string }
      }>
      files: Array<{
        filename: string
        status: string
        additions: number
        deletions: number
        changes: number
      }>
    }
  }
}

export const compareCommitsTool: ToolConfig<CompareCommitsParams, CompareCommitsResponse> = {
  id: 'github_compare_commits',
  name: 'GitHub Compare Commits',
  description:
    'Compare two commits or branches to see the diff, commits between them, and changed files',
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
    base: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Base branch/tag/SHA for comparison',
    },
    head: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Head branch/tag/SHA for comparison',
    },
    per_page: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Results per page for files (max 100, default: 30)',
      default: 30,
    },
    page: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Page number for files (default: 1)',
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
      const url = new URL(
        `https://api.github.com/repos/${params.owner}/${params.repo}/compare/${params.base}...${params.head}`
      )
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

    const commits = (data.commits ?? []).map((c: any) => ({
      sha: c.sha,
      html_url: c.html_url,
      message: c.commit.message,
      author: {
        login: c.author?.login,
        name: c.commit.author.name,
      },
    }))

    const files = (data.files ?? []).map((f: any) => ({
      filename: f.filename,
      status: f.status,
      additions: f.additions,
      deletions: f.deletions,
      changes: f.changes,
    }))

    const metadata = {
      status: data.status,
      ahead_by: data.ahead_by,
      behind_by: data.behind_by,
      total_commits: data.total_commits,
      html_url: data.html_url,
      diff_url: data.diff_url,
      patch_url: data.patch_url,
      base_commit: {
        sha: data.base_commit.sha,
        html_url: data.base_commit.html_url,
      },
      merge_base_commit: {
        sha: data.merge_base_commit.sha,
        html_url: data.merge_base_commit.html_url,
      },
      commits,
      files,
    }

    const content = `Comparing ${data.base_commit.sha.substring(0, 7)}...${data.commits?.length > 0 ? data.commits[data.commits.length - 1].sha.substring(0, 7) : 'HEAD'}
Status: ${data.status} | Ahead: ${data.ahead_by} | Behind: ${data.behind_by}
Total commits: ${data.total_commits} | Files changed: ${files.length}
${data.html_url}

Commits:
${commits.map((c: any) => `  ${c.sha.substring(0, 7)} - ${c.message.split('\n')[0]}`).join('\n')}

Files changed:
${files.map((f: any) => `  ${f.status}: ${f.filename} (+${f.additions} -${f.deletions})`).join('\n')}`

    return {
      success: true,
      output: {
        content,
        metadata,
      },
    }
  },

  outputs: {
    content: { type: 'string', description: 'Human-readable comparison' },
    metadata: {
      type: 'object',
      description: 'Comparison metadata',
      properties: {
        status: { type: 'string', description: 'ahead, behind, identical, or diverged' },
        ahead_by: { type: 'number', description: 'Commits ahead' },
        behind_by: { type: 'number', description: 'Commits behind' },
        total_commits: { type: 'number', description: 'Total commits between' },
        html_url: { type: 'string', description: 'GitHub web URL' },
        diff_url: { type: 'string', description: 'Diff URL' },
        patch_url: { type: 'string', description: 'Patch URL' },
        base_commit: { type: 'object', description: 'Base commit info' },
        merge_base_commit: { type: 'object', description: 'Merge base commit info' },
        commits: {
          type: 'array',
          description: 'Commits between base and head',
          items: {
            type: 'object',
            properties: {
              sha: { type: 'string', description: 'Commit SHA' },
              html_url: { type: 'string', description: 'Web URL' },
              message: { type: 'string', description: 'Commit message' },
              author: { type: 'object', description: 'Author info' },
            },
          },
        },
        files: {
          type: 'array',
          description: 'Changed files',
          items: {
            type: 'object',
            properties: {
              filename: { type: 'string', description: 'File path' },
              status: { type: 'string', description: 'Change type' },
              additions: { type: 'number', description: 'Lines added' },
              deletions: { type: 'number', description: 'Lines deleted' },
              changes: { type: 'number', description: 'Total changes' },
            },
          },
        },
      },
    },
  },
}

export const compareCommitsV2Tool: ToolConfig<CompareCommitsParams, any> = {
  id: 'github_compare_commits_v2',
  name: compareCommitsTool.name,
  description: compareCommitsTool.description,
  version: '2.0.0',
  params: compareCommitsTool.params,
  request: compareCommitsTool.request,

  transformResponse: async (response: Response) => {
    const data = await response.json()
    return {
      success: true,
      output: {
        ...data,
        commits: data.commits ?? [],
        files: data.files ?? [],
      },
    }
  },

  outputs: {
    url: { type: 'string', description: 'API URL' },
    html_url: { type: 'string', description: 'GitHub web URL' },
    permalink_url: { type: 'string', description: 'Permanent link URL' },
    diff_url: { type: 'string', description: 'Diff download URL' },
    patch_url: { type: 'string', description: 'Patch download URL' },
    status: {
      type: 'string',
      description: 'Comparison status (ahead, behind, identical, diverged)',
    },
    ahead_by: { type: 'number', description: 'Commits head is ahead of base' },
    behind_by: { type: 'number', description: 'Commits head is behind base' },
    total_commits: { type: 'number', description: 'Total commits in comparison' },
    base_commit: {
      type: 'object',
      description: 'Base commit object',
      properties: {
        sha: { type: 'string', description: 'Commit SHA' },
        html_url: { type: 'string', description: 'Web URL' },
        commit: COMMIT_DATA_OUTPUT,
        author: USER_FULL_OUTPUT,
        committer: USER_FULL_OUTPUT,
      },
    },
    merge_base_commit: {
      type: 'object',
      description: 'Merge base commit object',
      properties: {
        sha: { type: 'string', description: 'Commit SHA' },
        html_url: { type: 'string', description: 'Web URL' },
      },
    },
    commits: {
      type: 'array',
      description: 'Commits between base and head',
      items: {
        type: 'object',
        properties: {
          sha: { type: 'string', description: 'Commit SHA' },
          html_url: { type: 'string', description: 'Web URL' },
          commit: COMMIT_DATA_OUTPUT,
          author: USER_FULL_OUTPUT,
          committer: USER_FULL_OUTPUT,
        },
      },
    },
    files: {
      type: 'array',
      description: 'Changed files (diff entries)',
      items: {
        type: 'object',
        properties: COMMIT_FILE_OUTPUT_PROPERTIES,
      },
    },
  },
}
