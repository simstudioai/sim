import type { ToolConfig } from '@/tools/types'

interface UpdateGistParams {
  gist_id: string
  description?: string
  files?: string
  apiKey: string
}

interface UpdateGistResponse {
  success: boolean
  output: {
    content: string
    metadata: {
      id: string
      html_url: string
      description: string | null
      public: boolean
      updated_at: string
      files: Record<
        string,
        { filename: string; type: string; language: string | null; size: number }
      >
    }
  }
}

export const updateGistTool: ToolConfig<UpdateGistParams, UpdateGistResponse> = {
  id: 'github_update_gist',
  name: 'GitHub Update Gist',
  description:
    'Update a gist description or files. To delete a file, set its value to null in files object',
  version: '1.0.0',

  params: {
    gist_id: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'The gist ID to update',
    },
    description: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'New description for the gist',
    },
    files: {
      type: 'json',
      required: false,
      visibility: 'user-or-llm',
      description:
        'JSON object with filenames as keys. Set to null to delete, or provide content to update/add',
    },
    apiKey: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'GitHub API token',
    },
  },

  request: {
    url: (params) => `https://api.github.com/gists/${params.gist_id?.trim()}`,
    method: 'PATCH',
    headers: (params) => ({
      Accept: 'application/vnd.github.v3+json',
      Authorization: `Bearer ${params.apiKey}`,
      'Content-Type': 'application/json',
      'X-GitHub-Api-Version': '2022-11-28',
    }),
    body: (params) => {
      const body: Record<string, any> = {}
      if (params.description !== undefined) body.description = params.description
      if (params.files) {
        body.files = typeof params.files === 'string' ? JSON.parse(params.files) : params.files
      }
      return body
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

    const content = `Updated gist: ${data.html_url}
Description: ${data.description ?? 'No description'}
Files: ${Object.keys(files).join(', ')}`

    return {
      success: true,
      output: {
        content,
        metadata: {
          id: data.id,
          html_url: data.html_url,
          description: data.description ?? null,
          public: data.public,
          updated_at: data.updated_at,
          files,
        },
      },
    }
  },

  outputs: {
    content: { type: 'string', description: 'Human-readable result' },
    metadata: {
      type: 'object',
      description: 'Updated gist metadata',
      properties: {
        id: { type: 'string', description: 'Gist ID' },
        html_url: { type: 'string', description: 'Web URL' },
        description: { type: 'string', description: 'Description', optional: true },
        public: { type: 'boolean', description: 'Is public' },
        updated_at: { type: 'string', description: 'Update date' },
        files: { type: 'object', description: 'Current files' },
      },
    },
  },
}

export const updateGistV2Tool: ToolConfig<UpdateGistParams, any> = {
  id: 'github_update_gist_v2',
  name: updateGistTool.name,
  description: updateGistTool.description,
  version: '2.0.0',
  params: updateGistTool.params,
  request: updateGistTool.request,

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
