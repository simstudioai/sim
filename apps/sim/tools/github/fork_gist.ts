import type { ToolConfig } from '@/tools/types'

interface ForkGistParams {
  gist_id: string
  apiKey: string
}

interface ForkGistResponse {
  success: boolean
  output: {
    content: string
    metadata: {
      id: string
      html_url: string
      git_pull_url: string
      description: string | null
      public: boolean
      created_at: string
      owner: { login: string }
      files: string[]
    }
  }
}

export const forkGistTool: ToolConfig<ForkGistParams, ForkGistResponse> = {
  id: 'github_fork_gist',
  name: 'GitHub Fork Gist',
  description: 'Fork a gist to create your own copy',
  version: '1.0.0',

  params: {
    gist_id: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'The gist ID to fork',
    },
    apiKey: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'GitHub API token',
    },
  },

  request: {
    url: (params) => `https://api.github.com/gists/${params.gist_id?.trim()}/forks`,
    method: 'POST',
    headers: (params) => ({
      Accept: 'application/vnd.github.v3+json',
      Authorization: `Bearer ${params.apiKey}`,
      'X-GitHub-Api-Version': '2022-11-28',
    }),
  },

  transformResponse: async (response) => {
    const data = await response.json()

    const files = Object.keys(data.files ?? {})

    const content = `Forked gist: ${data.html_url}
Description: ${data.description ?? 'No description'}
Files: ${files.join(', ')}`

    return {
      success: true,
      output: {
        content,
        metadata: {
          id: data.id,
          html_url: data.html_url,
          git_pull_url: data.git_pull_url,
          description: data.description ?? null,
          public: data.public,
          created_at: data.created_at,
          owner: { login: data.owner?.login ?? 'unknown' },
          files,
        },
      },
    }
  },

  outputs: {
    content: { type: 'string', description: 'Human-readable result' },
    metadata: {
      type: 'object',
      description: 'Forked gist metadata',
      properties: {
        id: { type: 'string', description: 'New gist ID' },
        html_url: { type: 'string', description: 'Web URL' },
        git_pull_url: { type: 'string', description: 'Git pull URL' },
        description: { type: 'string', description: 'Description', optional: true },
        public: { type: 'boolean', description: 'Is public' },
        created_at: { type: 'string', description: 'Creation date' },
        owner: { type: 'object', description: 'Owner info' },
        files: { type: 'array', description: 'File names' },
      },
    },
  },
}

export const forkGistV2Tool: ToolConfig<ForkGistParams, any> = {
  id: 'github_fork_gist_v2',
  name: forkGistTool.name,
  description: forkGistTool.description,
  version: '2.0.0',
  params: forkGistTool.params,
  request: forkGistTool.request,

  transformResponse: async (response: Response) => {
    const data = await response.json()
    return {
      success: true,
      output: {
        ...data,
        description: data.description ?? null,
        files: data.files ?? {},
      },
    }
  },

  outputs: {
    id: { type: 'string', description: 'New gist ID' },
    html_url: { type: 'string', description: 'Web URL' },
    description: { type: 'string', description: 'Description', optional: true },
    public: { type: 'boolean', description: 'Is public' },
    created_at: { type: 'string', description: 'Creation date' },
    owner: { type: 'object', description: 'Owner info' },
    files: { type: 'object', description: 'Files' },
  },
}
