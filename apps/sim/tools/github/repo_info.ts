import type { BaseGitHubParams, RepoInfoResponse } from '@/tools/github/types'
import {
  LICENSE_OUTPUT,
  LICENSE_OUTPUT_PROPERTIES,
  USER_FULL_OUTPUT,
  USER_FULL_OUTPUT_PROPERTIES,
} from '@/tools/github/types'
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

export const repoInfoV2Tool: ToolConfig<BaseGitHubParams, any> = {
  id: 'github_repo_info_v2',
  name: repoInfoTool.name,
  description: repoInfoTool.description,
  version: '2.0.0',
  params: repoInfoTool.params,
  request: repoInfoTool.request,

  transformResponse: async (response: Response) => {
    const data = await response.json()
    return {
      success: true,
      output: {
        id: data.id,
        name: data.name,
        full_name: data.full_name,
        description: data.description ?? null,
        html_url: data.html_url,
        homepage: data.homepage ?? null,
        language: data.language ?? null,
        default_branch: data.default_branch,
        visibility: data.visibility,
        private: data.private,
        fork: data.fork,
        archived: data.archived,
        disabled: data.disabled,
        stargazers_count: data.stargazers_count,
        watchers_count: data.watchers_count,
        forks_count: data.forks_count,
        open_issues_count: data.open_issues_count,
        topics: data.topics ?? [],
        created_at: data.created_at,
        updated_at: data.updated_at,
        pushed_at: data.pushed_at,
        owner: data.owner,
        license: data.license ?? null,
      },
    }
  },

  outputs: {
    id: { type: 'number', description: 'Repository ID' },
    name: { type: 'string', description: 'Repository name' },
    full_name: { type: 'string', description: 'Full repository name (owner/repo)' },
    description: { type: 'string', description: 'Repository description', optional: true },
    html_url: { type: 'string', description: 'GitHub web URL' },
    homepage: { type: 'string', description: 'Homepage URL', optional: true },
    language: { type: 'string', description: 'Primary programming language', optional: true },
    default_branch: { type: 'string', description: 'Default branch name' },
    visibility: { type: 'string', description: 'Repository visibility (public/private)' },
    private: { type: 'boolean', description: 'Whether the repository is private' },
    fork: { type: 'boolean', description: 'Whether this is a fork' },
    archived: { type: 'boolean', description: 'Whether the repository is archived' },
    disabled: { type: 'boolean', description: 'Whether the repository is disabled' },
    stargazers_count: { type: 'number', description: 'Number of stars' },
    watchers_count: { type: 'number', description: 'Number of watchers' },
    forks_count: { type: 'number', description: 'Number of forks' },
    open_issues_count: { type: 'number', description: 'Number of open issues' },
    topics: { type: 'array', description: 'Repository topics' },
    created_at: { type: 'string', description: 'Creation timestamp' },
    updated_at: { type: 'string', description: 'Last update timestamp' },
    pushed_at: { type: 'string', description: 'Last push timestamp' },
    owner: {
      ...USER_FULL_OUTPUT,
      properties: USER_FULL_OUTPUT_PROPERTIES,
    },
    license: {
      ...LICENSE_OUTPUT,
      properties: LICENSE_OUTPUT_PROPERTIES,
    },
  },
}
