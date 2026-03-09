import { getFileExtension, getMimeTypeFromExtension } from '@/lib/uploads/utils/file-utils'
import type { FileContentResponse, GetFileContentParams } from '@/tools/github/types'
import type { ToolConfig } from '@/tools/types'

export const getFileContentTool: ToolConfig<GetFileContentParams, FileContentResponse> = {
  id: 'github_get_file_content',
  name: 'GitHub Get File Content',
  description:
    'Get the content of a file from a GitHub repository. Supports files up to 1MB. Content is returned decoded and human-readable.',
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
    path: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Path to the file in the repository (e.g., "src/index.ts")',
    },
    ref: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Branch name, tag, or commit SHA (defaults to repository default branch)',
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
      const baseUrl = `https://api.github.com/repos/${params.owner}/${params.repo}/contents/${params.path}`
      return params.ref ? `${baseUrl}?ref=${params.ref}` : baseUrl
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

    if (Array.isArray(data)) {
      return {
        success: false,
        error: 'Path points to a directory. Use github_get_tree to list directory contents.',
        output: {
          content: '',
          metadata: {
            name: '',
            path: '',
            sha: '',
            size: 0,
            type: 'dir',
            download_url: '',
            html_url: '',
          },
        },
      }
    }

    let decodedContent = ''
    let file:
      | {
          name: string
          mimeType: string
          data: string
          size: number
        }
      | undefined
    if (data.content) {
      try {
        decodedContent = Buffer.from(data.content, 'base64').toString('utf-8')
      } catch (error) {
        decodedContent = '[Binary file - content cannot be displayed as text]'
      }
    }
    if (data.content && data.encoding === 'base64' && data.name) {
      const base64Data = String(data.content).replace(/\n/g, '')
      const extension = getFileExtension(data.name)
      const mimeType = getMimeTypeFromExtension(extension)
      file = {
        name: data.name,
        mimeType,
        data: base64Data,
        size: data.size || 0,
      }
    }

    const contentPreview =
      decodedContent.length > 500
        ? `${decodedContent.substring(0, 500)}...\n\n[Content truncated. Full content available in metadata]`
        : decodedContent

    const content = `File: ${data.name}
Path: ${data.path}
Size: ${data.size} bytes
Type: ${data.type}
SHA: ${data.sha}

Content Preview:
${contentPreview}`

    return {
      success: true,
      output: {
        content,
        file,
        metadata: {
          name: data.name,
          path: data.path,
          sha: data.sha,
          size: data.size,
          type: data.type,
          download_url: data.download_url,
          html_url: data.html_url,
        },
      },
    }
  },

  outputs: {
    content: {
      type: 'string',
      description: 'Human-readable file information with content preview',
    },
    file: {
      type: 'file',
      description: 'Downloaded file stored in execution files',
      optional: true,
    },
    metadata: {
      type: 'object',
      description: 'File metadata including name, path, SHA, size, and URLs',
      properties: {
        name: { type: 'string', description: 'File name' },
        path: { type: 'string', description: 'Full path in repository' },
        sha: { type: 'string', description: 'Git blob SHA' },
        size: { type: 'number', description: 'File size in bytes' },
        type: { type: 'string', description: 'Content type (file or dir)' },
        download_url: { type: 'string', description: 'Direct download URL', optional: true },
        html_url: { type: 'string', description: 'GitHub web UI URL', optional: true },
      },
    },
  },
}

export const getFileContentV2Tool: ToolConfig<GetFileContentParams, any> = {
  id: 'github_get_file_content_v2',
  name: getFileContentTool.name,
  description: getFileContentTool.description,
  version: '2.0.0',
  params: getFileContentTool.params,
  request: getFileContentTool.request,

  transformResponse: async (response: Response) => {
    const data = await response.json()

    // Decode base64 content if present
    let decodedContent = ''
    let file:
      | {
          name: string
          mimeType: string
          data: string
          size: number
        }
      | undefined
    if (data.content && data.encoding === 'base64') {
      try {
        decodedContent = Buffer.from(data.content, 'base64').toString('utf-8')
      } catch {
        decodedContent = data.content
      }
    }
    if (data.content && data.encoding === 'base64' && data.name) {
      const base64Data = String(data.content).replace(/\n/g, '')
      const extension = getFileExtension(data.name)
      const mimeType = getMimeTypeFromExtension(extension)
      file = {
        name: data.name,
        mimeType,
        data: base64Data,
        size: data.size || 0,
      }
    }

    return {
      success: true,
      output: {
        name: data.name,
        path: data.path,
        sha: data.sha,
        size: data.size,
        type: data.type,
        content: (decodedContent || data.content) ?? null,
        encoding: data.encoding,
        html_url: data.html_url,
        download_url: data.download_url ?? null,
        git_url: data.git_url,
        _links: data._links,
        file,
      },
    }
  },

  outputs: {
    name: { type: 'string', description: 'File name' },
    path: { type: 'string', description: 'Full path in repository' },
    sha: { type: 'string', description: 'Git blob SHA' },
    size: { type: 'number', description: 'File size in bytes' },
    type: { type: 'string', description: 'Content type (file/dir/symlink/submodule)' },
    content: { type: 'string', description: 'Decoded file content', optional: true },
    encoding: { type: 'string', description: 'Content encoding' },
    html_url: { type: 'string', description: 'GitHub web URL' },
    download_url: { type: 'string', description: 'Direct download URL', optional: true },
    git_url: { type: 'string', description: 'Git blob API URL' },
    _links: { type: 'json', description: 'Related links' },
    file: {
      type: 'file',
      description: 'Downloaded file stored in execution files',
      optional: true,
    },
  },
}
