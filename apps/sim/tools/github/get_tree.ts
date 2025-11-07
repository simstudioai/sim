import type { GetTreeParams, TreeResponse } from '@/tools/github/types'
import type { ToolConfig } from '@/tools/types'

export const getTreeTool: ToolConfig<GetTreeParams, TreeResponse> = {
  id: 'github_get_tree',
  name: 'GitHub Get Repository Tree',
  description:
    'Get the contents of a directory in a GitHub repository. Returns a list of files and subdirectories. Use empty path or omit to get root directory contents.',
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
      required: false,
      visibility: 'user-or-llm',
      description: 'Directory path (e.g., "src/components"). Leave empty for root directory.',
      default: '',
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
      const path = params.path || ''
      const baseUrl = `https://api.github.com/repos/${params.owner}/${params.repo}/contents/${path}`
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

    if (!Array.isArray(data)) {
      return {
        success: false,
        error: 'Path points to a file. Use github_get_file_content to get file contents.',
        output: {
          content: '',
          metadata: {
            path: '',
            items: [],
            total_count: 0,
          },
        },
      }
    }

    const items = data.map((item: any) => ({
      name: item.name,
      path: item.path,
      sha: item.sha,
      size: item.size,
      type: item.type,
      download_url: item.download_url,
      html_url: item.html_url,
    }))

    const files = items.filter((item) => item.type === 'file')
    const dirs = items.filter((item) => item.type === 'dir')
    const other = items.filter((item) => item.type !== 'file' && item.type !== 'dir')

    let content = `Repository Tree: ${data[0]?.path ? data[0].path.split('/').slice(0, -1).join('/') || '/' : '/'}
Total items: ${items.length}

`

    if (dirs.length > 0) {
      content += `Directories (${dirs.length}):\n`
      dirs.forEach((dir) => {
        content += `  - ${dir.name}/\n`
      })
      content += '\n'
    }

    if (files.length > 0) {
      content += `Files (${files.length}):\n`
      files.forEach((file) => {
        const sizeKB = (file.size / 1024).toFixed(2)
        content += `  - ${file.name} (${sizeKB} KB)\n`
      })
      content += '\n'
    }

    if (other.length > 0) {
      content += `Other (${other.length}):\n`
      other.forEach((item) => {
        content += `  - ${item.name} [${item.type}]\n`
      })
    }

    return {
      success: true,
      output: {
        content,
        metadata: {
          path: data[0]?.path?.split('/').slice(0, -1).join('/') || '/',
          items,
          total_count: items.length,
        },
      },
    }
  },

  outputs: {
    content: {
      type: 'string',
      description: 'Human-readable directory tree listing',
    },
    metadata: {
      type: 'object',
      description: 'Directory contents metadata',
      properties: {
        path: { type: 'string', description: 'Directory path' },
        items: {
          type: 'array',
          description: 'Array of files and directories',
          items: {
            type: 'object',
            properties: {
              name: { type: 'string', description: 'File or directory name' },
              path: { type: 'string', description: 'Full path in repository' },
              sha: { type: 'string', description: 'Git object SHA' },
              size: { type: 'number', description: 'Size in bytes' },
              type: { type: 'string', description: 'Type (file, dir, symlink, submodule)' },
              download_url: { type: 'string', description: 'Direct download URL (files only)' },
              html_url: { type: 'string', description: 'GitHub web UI URL' },
            },
          },
        },
        total_count: { type: 'number', description: 'Total number of items' },
      },
    },
  },
}
