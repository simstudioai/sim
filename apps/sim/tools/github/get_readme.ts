import type { GetReadmeParams, ReadmeResponse } from '@/tools/github/types'
import type { ToolConfig } from '@/tools/types'

export const getReadmeTool: ToolConfig<GetReadmeParams, ReadmeResponse> = {
  id: 'github_get_readme',
  name: 'GitHub Get README',
  description:
    'Get the preferred README for a GitHub repository, with its content decoded to plain text.',
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
    ref: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        'The name of the commit/branch/tag to read the README from (defaults to the repository default branch)',
    },
    apiKey: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'GitHub Personal Access Token',
    },
  },

  request: {
    url: (params) => {
      const baseUrl = `https://api.github.com/repos/${params.owner}/${params.repo}/readme`
      return params.ref ? `${baseUrl}?ref=${encodeURIComponent(params.ref)}` : baseUrl
    },
    method: 'GET',
    headers: (params) => ({
      Accept: 'application/vnd.github+json',
      Authorization: `Bearer ${params.apiKey}`,
      'X-GitHub-Api-Version': '2022-11-28',
    }),
  },

  transformResponse: async (response) => {
    const data = await response.json()

    let decodedContent = ''
    if (data.content) {
      try {
        decodedContent = Buffer.from(data.content, 'base64').toString('utf-8')
      } catch {
        decodedContent = '[Binary file - content cannot be displayed as text]'
      }
    }

    const content = `README: ${data.name}
Path: ${data.path}
Size: ${data.size} bytes

${decodedContent}`

    return {
      success: true,
      output: {
        content,
        metadata: {
          name: data.name,
          path: data.path,
          sha: data.sha,
          size: data.size,
          html_url: data.html_url,
          download_url: data.download_url,
        },
      },
    }
  },

  outputs: {
    content: { type: 'string', description: 'README name, path, and decoded text content' },
    metadata: {
      type: 'object',
      description: 'README file metadata',
      properties: {
        name: { type: 'string', description: 'README file name' },
        path: { type: 'string', description: 'README file path' },
        sha: { type: 'string', description: 'Blob SHA of the README' },
        size: { type: 'number', description: 'File size in bytes' },
        html_url: { type: 'string', description: 'GitHub web URL for the README' },
        download_url: { type: 'string', description: 'Raw download URL for the README' },
      },
    },
  },
}

export const getReadmeV2Tool: ToolConfig<GetReadmeParams, any> = {
  id: 'github_get_readme_v2',
  name: getReadmeTool.name,
  description: getReadmeTool.description,
  version: '2.0.0',
  params: getReadmeTool.params,
  request: getReadmeTool.request,

  transformResponse: async (response: Response) => {
    const data = await response.json()

    let decodedContent = ''
    if (data.content) {
      try {
        decodedContent = Buffer.from(data.content, 'base64').toString('utf-8')
      } catch {
        decodedContent = ''
      }
    }

    return {
      success: true,
      output: {
        name: data.name,
        path: data.path,
        sha: data.sha,
        size: data.size,
        encoding: data.encoding,
        html_url: data.html_url,
        download_url: data.download_url ?? null,
        content: decodedContent,
      },
    }
  },

  outputs: {
    name: { type: 'string', description: 'README file name' },
    path: { type: 'string', description: 'README file path' },
    sha: { type: 'string', description: 'Blob SHA of the README' },
    size: { type: 'number', description: 'File size in bytes' },
    encoding: { type: 'string', description: 'Original content encoding from the API' },
    html_url: { type: 'string', description: 'GitHub web URL for the README' },
    download_url: { type: 'string', description: 'Raw download URL for the README' },
    content: { type: 'string', description: 'Decoded README text content' },
  },
}
