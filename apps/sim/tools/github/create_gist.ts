import type { ToolConfig } from '@/tools/types'

interface CreateGistParams {
  description?: string
  files: string
  public?: boolean
  apiKey: string
}

interface CreateGistResponse {
  success: boolean
  output: {
    content: string
    metadata: {
      id: string
      html_url: string
      git_pull_url: string
      git_push_url: string
      description: string | null
      public: boolean
      created_at: string
      updated_at: string
      files: Record<
        string,
        { filename: string; type: string; language: string | null; size: number }
      >
      owner: { login: string }
    }
  }
}

export const createGistTool: ToolConfig<CreateGistParams, CreateGistResponse> = {
  id: 'github_create_gist',
  name: 'GitHub Create Gist',
  description: 'Create a new gist with one or more files',
  version: '1.0.0',

  params: {
    description: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Description of the gist',
    },
    files: {
      type: 'json',
      required: true,
      visibility: 'user-or-llm',
      description:
        'JSON object with filenames as keys and content as values. Example: {"file.txt": {"content": "Hello"}}',
    },
    public: {
      type: 'boolean',
      required: false,
      visibility: 'user-or-llm',
      description: 'Whether the gist is public (default: false)',
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
    url: () => 'https://api.github.com/gists',
    method: 'POST',
    headers: (params) => ({
      Accept: 'application/vnd.github.v3+json',
      Authorization: `Bearer ${params.apiKey}`,
      'Content-Type': 'application/json',
      'X-GitHub-Api-Version': '2022-11-28',
    }),
    body: (params) => {
      const filesObj = typeof params.files === 'string' ? JSON.parse(params.files) : params.files
      return {
        description: params.description,
        public: params.public ?? false,
        files: filesObj,
      }
    },
  },

  transformResponse: async (response) => {
    const data = await response.json()

    const files: Record<
      string,
      { filename: string; type: string; language: string | null; size: number }
    > = {}
    for (const [key, value] of Object.entries(data.files ?? {})) {
      const file = value as any
      files[key] = {
        filename: file.filename,
        type: file.type,
        language: file.language ?? null,
        size: file.size,
      }
    }

    const metadata = {
      id: data.id,
      html_url: data.html_url,
      git_pull_url: data.git_pull_url,
      git_push_url: data.git_push_url,
      description: data.description ?? null,
      public: data.public,
      created_at: data.created_at,
      updated_at: data.updated_at,
      files,
      owner: { login: data.owner?.login ?? 'unknown' },
    }

    const content = `Created gist: ${data.html_url}
Description: ${data.description ?? 'No description'}
Public: ${data.public}
Files: ${Object.keys(files).join(', ')}`

    return {
      success: true,
      output: {
        content,
        metadata,
      },
    }
  },

  outputs: {
    content: { type: 'string', description: 'Human-readable result' },
    metadata: {
      type: 'object',
      description: 'Gist metadata',
      properties: {
        id: { type: 'string', description: 'Gist ID' },
        html_url: { type: 'string', description: 'Web URL' },
        git_pull_url: { type: 'string', description: 'Git pull URL' },
        git_push_url: { type: 'string', description: 'Git push URL' },
        description: { type: 'string', description: 'Description', optional: true },
        public: { type: 'boolean', description: 'Is public' },
        created_at: { type: 'string', description: 'Creation date' },
        updated_at: { type: 'string', description: 'Update date' },
        files: { type: 'object', description: 'Files in gist' },
        owner: { type: 'object', description: 'Owner info' },
      },
    },
  },
}

export const createGistV2Tool: ToolConfig<CreateGistParams, any> = {
  id: 'github_create_gist_v2',
  name: createGistTool.name,
  description: createGistTool.description,
  version: '2.0.0',
  params: createGistTool.params,
  request: createGistTool.request,

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
    id: { type: 'string', description: 'Gist ID' },
    node_id: { type: 'string', description: 'GraphQL node ID' },
    url: { type: 'string', description: 'API URL' },
    html_url: { type: 'string', description: 'Web URL' },
    forks_url: { type: 'string', description: 'Forks API URL' },
    commits_url: { type: 'string', description: 'Commits API URL' },
    git_pull_url: { type: 'string', description: 'Git pull URL' },
    git_push_url: { type: 'string', description: 'Git push URL' },
    description: { type: 'string', description: 'Gist description', optional: true },
    public: { type: 'boolean', description: 'Whether gist is public' },
    truncated: { type: 'boolean', description: 'Whether files are truncated' },
    comments: { type: 'number', description: 'Number of comments' },
    comments_url: { type: 'string', description: 'Comments API URL' },
    created_at: { type: 'string', description: 'Creation timestamp' },
    updated_at: { type: 'string', description: 'Last update timestamp' },
    files: {
      type: 'object',
      description:
        'Files in the gist (object with filenames as keys, each containing filename, type, language, raw_url, size, truncated, content)',
    },
    owner: {
      type: 'object',
      description: 'Gist owner',
      optional: true,
      properties: {
        login: { type: 'string', description: 'Username' },
        id: { type: 'number', description: 'User ID' },
        node_id: { type: 'string', description: 'GraphQL node ID' },
        avatar_url: { type: 'string', description: 'Avatar image URL' },
        url: { type: 'string', description: 'API URL' },
        html_url: { type: 'string', description: 'Profile page URL' },
        type: { type: 'string', description: 'User or Organization' },
        site_admin: { type: 'boolean', description: 'GitHub staff indicator' },
      },
    },
  },
}
