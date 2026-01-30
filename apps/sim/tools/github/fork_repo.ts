import {
  PARENT_OWNER_OUTPUT_PROPERTIES,
  PARENT_REPO_OUTPUT_PROPERTIES,
  SOURCE_REPO_OUTPUT_PROPERTIES,
  USER_FULL_OUTPUT_PROPERTIES,
} from '@/tools/github/types'
import type { ToolConfig } from '@/tools/types'

interface ForkRepoParams {
  owner: string
  repo: string
  organization?: string
  name?: string
  default_branch_only?: boolean
  apiKey: string
}

interface ForkRepoResponse {
  success: boolean
  output: {
    content: string
    metadata: {
      id: number
      full_name: string
      html_url: string
      clone_url: string
      ssh_url: string
      default_branch: string
      fork: boolean
      parent: { full_name: string; html_url: string }
      owner: { login: string }
      created_at: string
    }
  }
}

export const forkRepoTool: ToolConfig<ForkRepoParams, ForkRepoResponse> = {
  id: 'github_fork_repo',
  name: 'GitHub Fork Repository',
  description: 'Fork a repository to your account or an organization',
  version: '1.0.0',

  params: {
    owner: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Repository owner to fork from',
    },
    repo: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Repository name to fork',
    },
    organization: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Organization to fork into (omit to fork to your account)',
    },
    name: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Custom name for the forked repository',
    },
    default_branch_only: {
      type: 'boolean',
      required: false,
      visibility: 'user-or-llm',
      description: 'Only fork the default branch (default: false)',
      default: false,
    },
    apiKey: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'GitHub API token',
    },
  },

  request: {
    url: (params) => `https://api.github.com/repos/${params.owner}/${params.repo}/forks`,
    method: 'POST',
    headers: (params) => ({
      Accept: 'application/vnd.github.v3+json',
      Authorization: `Bearer ${params.apiKey}`,
      'Content-Type': 'application/json',
      'X-GitHub-Api-Version': '2022-11-28',
    }),
    body: (params) => {
      const body: Record<string, any> = {}
      if (params.organization) body.organization = params.organization
      if (params.name) body.name = params.name
      if (params.default_branch_only !== undefined)
        body.default_branch_only = params.default_branch_only
      return body
    },
  },

  transformResponse: async (response) => {
    const data = await response.json()

    const content = `Forked repository: ${data.html_url}
Forked from: ${data.parent?.full_name ?? 'unknown'}
Clone URL: ${data.clone_url}
Default branch: ${data.default_branch}`

    return {
      success: true,
      output: {
        content,
        metadata: {
          id: data.id,
          full_name: data.full_name,
          html_url: data.html_url,
          clone_url: data.clone_url,
          ssh_url: data.ssh_url,
          default_branch: data.default_branch,
          fork: data.fork,
          parent: {
            full_name: data.parent?.full_name ?? '',
            html_url: data.parent?.html_url ?? '',
          },
          owner: { login: data.owner?.login ?? 'unknown' },
          created_at: data.created_at,
        },
      },
    }
  },

  outputs: {
    content: { type: 'string', description: 'Human-readable result' },
    metadata: {
      type: 'object',
      description: 'Forked repository metadata',
      properties: {
        id: { type: 'number', description: 'Repository ID' },
        full_name: { type: 'string', description: 'Full name (owner/repo)' },
        html_url: { type: 'string', description: 'Web URL' },
        clone_url: { type: 'string', description: 'HTTPS clone URL' },
        ssh_url: { type: 'string', description: 'SSH clone URL' },
        default_branch: { type: 'string', description: 'Default branch' },
        fork: { type: 'boolean', description: 'Is a fork' },
        parent: { type: 'object', description: 'Parent repository' },
        owner: { type: 'object', description: 'Owner info' },
        created_at: { type: 'string', description: 'Creation date' },
      },
    },
  },
}

export const forkRepoV2Tool: ToolConfig<ForkRepoParams, any> = {
  id: 'github_fork_repo_v2',
  name: forkRepoTool.name,
  description: forkRepoTool.description,
  version: '2.0.0',
  params: forkRepoTool.params,
  request: forkRepoTool.request,

  transformResponse: async (response: Response) => {
    const data = await response.json()
    return {
      success: true,
      output: {
        ...data,
        parent: data.parent ?? null,
        source: data.source ?? null,
      },
    }
  },

  outputs: {
    id: { type: 'number', description: 'Repository ID' },
    node_id: { type: 'string', description: 'GraphQL node ID' },
    name: { type: 'string', description: 'Repository name' },
    full_name: { type: 'string', description: 'Full name (owner/repo)' },
    private: { type: 'boolean', description: 'Whether repository is private' },
    description: { type: 'string', description: 'Repository description', optional: true },
    html_url: { type: 'string', description: 'GitHub web URL' },
    url: { type: 'string', description: 'API URL' },
    clone_url: { type: 'string', description: 'HTTPS clone URL' },
    ssh_url: { type: 'string', description: 'SSH clone URL' },
    git_url: { type: 'string', description: 'Git protocol URL' },
    default_branch: { type: 'string', description: 'Default branch name' },
    fork: { type: 'boolean', description: 'Whether this is a fork' },
    created_at: { type: 'string', description: 'Creation timestamp' },
    updated_at: { type: 'string', description: 'Last update timestamp' },
    pushed_at: { type: 'string', description: 'Last push timestamp', optional: true },
    owner: {
      type: 'object',
      description: 'Fork owner',
      properties: USER_FULL_OUTPUT_PROPERTIES,
    },
    parent: {
      type: 'object',
      description: 'Parent repository (source of the fork)',
      optional: true,
      properties: {
        ...PARENT_REPO_OUTPUT_PROPERTIES,
        owner: {
          type: 'object',
          description: 'Parent owner',
          properties: PARENT_OWNER_OUTPUT_PROPERTIES,
        },
      },
    },
    source: {
      type: 'object',
      description: 'Source repository (ultimate origin)',
      optional: true,
      properties: SOURCE_REPO_OUTPUT_PROPERTIES,
    },
  },
}
