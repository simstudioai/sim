import type { ToolConfig } from '@/tools/types'

interface GetGistParams {
  gist_id: string
  apiKey: string
}

interface GetGistResponse {
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
        { filename: string; type: string; language: string | null; size: number; content: string }
      >
      owner: { login: string }
      comments: number
      forks_url: string
      commits_url: string
    }
  }
}

export const getGistTool: ToolConfig<GetGistParams, GetGistResponse> = {
  id: 'github_get_gist',
  name: 'GitHub Get Gist',
  description: 'Get a gist by ID including its file contents',
  version: '1.0.0',

  params: {
    gist_id: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'The gist ID',
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
    method: 'GET',
    headers: (params) => ({
      Accept: 'application/vnd.github.v3+json',
      Authorization: `Bearer ${params.apiKey}`,
      'X-GitHub-Api-Version': '2022-11-28',
    }),
  },

  transformResponse: async (response) => {
    const data = await response.json()

    const files: Record<
      string,
      { filename: string; type: string; language: string | null; size: number; content: string }
    > = {}
    for (const [key, value] of Object.entries(data.files ?? {})) {
      const file = value as any
      files[key] = {
        filename: file.filename,
        type: file.type,
        language: file.language ?? null,
        size: file.size,
        content: file.content ?? '',
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
      comments: data.comments ?? 0,
      forks_url: data.forks_url,
      commits_url: data.commits_url,
    }

    const fileList = Object.entries(files)
      .map(([name, f]) => `${name} (${f.language ?? 'unknown'}, ${f.size} bytes)`)
      .join(', ')

    const content = `Gist: ${data.html_url}
Description: ${data.description ?? 'No description'}
Public: ${data.public} | Comments: ${data.comments ?? 0}
Owner: ${data.owner?.login ?? 'unknown'}
Files: ${fileList}

${Object.entries(files)
  .map(([name, f]) => `--- ${name} ---\n${f.content}`)
  .join('\n\n')}`

    return {
      success: true,
      output: {
        content,
        metadata,
      },
    }
  },

  outputs: {
    content: { type: 'string', description: 'Human-readable gist with file contents' },
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
        files: { type: 'object', description: 'Files with content' },
        owner: { type: 'object', description: 'Owner info' },
        comments: { type: 'number', description: 'Comment count' },
        forks_url: { type: 'string', description: 'Forks URL' },
        commits_url: { type: 'string', description: 'Commits URL' },
      },
    },
  },
}

export const getGistV2Tool: ToolConfig<GetGistParams, any> = {
  id: 'github_get_gist_v2',
  name: getGistTool.name,
  description: getGistTool.description,
  version: '2.0.0',
  params: getGistTool.params,
  request: getGistTool.request,

  transformResponse: async (response: Response) => {
    const data = await response.json()
    return {
      success: true,
      output: {
        ...data,
        description: data.description ?? null,
        files: data.files ?? {},
        comments: data.comments ?? 0,
      },
    }
  },

  outputs: {
    id: { type: 'string', description: 'Gist ID' },
    node_id: { type: 'string', description: 'GraphQL node ID' },
    html_url: { type: 'string', description: 'GitHub web URL' },
    url: { type: 'string', description: 'API URL' },
    forks_url: { type: 'string', description: 'Forks API URL' },
    commits_url: { type: 'string', description: 'Commits API URL' },
    git_pull_url: { type: 'string', description: 'Git clone URL' },
    git_push_url: { type: 'string', description: 'Git push URL' },
    description: { type: 'string', description: 'Gist description', optional: true },
    public: { type: 'boolean', description: 'Whether gist is public' },
    created_at: { type: 'string', description: 'Creation timestamp' },
    updated_at: { type: 'string', description: 'Last update timestamp' },
    comments: { type: 'number', description: 'Number of comments' },
    comments_url: { type: 'string', description: 'Comments API URL' },
    truncated: { type: 'boolean', description: 'Whether content is truncated' },
    files: {
      type: 'object',
      description: 'Files in the gist (keyed by filename)',
      properties: {
        '[filename]': {
          type: 'object',
          description: 'File object',
          properties: {
            filename: { type: 'string', description: 'File name' },
            type: { type: 'string', description: 'MIME type' },
            language: { type: 'string', description: 'Programming language', optional: true },
            raw_url: { type: 'string', description: 'Raw file URL' },
            size: { type: 'number', description: 'File size in bytes' },
            truncated: { type: 'boolean', description: 'Whether content is truncated' },
            content: { type: 'string', description: 'File content' },
          },
        },
      },
    },
    owner: {
      type: 'object',
      description: 'Gist owner',
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
