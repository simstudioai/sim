import type { CreateFileParams, FileOperationResponse } from '@/tools/github/types'
import type { ToolConfig } from '@/tools/types'

export const createFileTool: ToolConfig<CreateFileParams, FileOperationResponse> = {
  id: 'github_create_file',
  name: 'GitHub Create File',
  description:
    'Create a new file in a GitHub repository. The file content will be automatically Base64 encoded. Supports files up to 1MB.',
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
      description: 'Path where the file will be created (e.g., "src/newfile.ts")',
    },
    message: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Commit message for this file creation',
    },
    content: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'File content (plain text, will be Base64 encoded automatically)',
    },
    branch: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Branch to create the file in (defaults to repository default branch)',
    },
    apiKey: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'GitHub Personal Access Token',
    },
  },

  request: {
    url: (params) =>
      `https://api.github.com/repos/${params.owner}/${params.repo}/contents/${params.path}`,
    method: 'PUT',
    headers: (params) => ({
      Accept: 'application/vnd.github+json',
      Authorization: `Bearer ${params.apiKey}`,
      'X-GitHub-Api-Version': '2022-11-28',
    }),
    body: (params) => {
      const base64Content = Buffer.from(params.content).toString('base64')

      const body: Record<string, any> = {
        message: params.message,
        content: base64Content,
      }

      if (params.branch) {
        body.branch = params.branch
      }

      return body
    },
  },

  transformResponse: async (response) => {
    const data = await response.json()

    const content = `File created successfully!

Path: ${data.content.path}
Name: ${data.content.name}
Size: ${data.content.size} bytes
SHA: ${data.content.sha}

Commit:
- SHA: ${data.commit.sha}
- Message: ${data.commit.message}
- Author: ${data.commit.author.name}
- Date: ${data.commit.author.date}

View file: ${data.content.html_url}`

    return {
      success: true,
      output: {
        content,
        metadata: {
          file: {
            name: data.content.name,
            path: data.content.path,
            sha: data.content.sha,
            size: data.content.size,
            type: data.content.type,
            download_url: data.content.download_url,
            html_url: data.content.html_url,
          },
          commit: {
            sha: data.commit.sha,
            message: data.commit.message,
            author: {
              name: data.commit.author.name,
              email: data.commit.author.email,
              date: data.commit.author.date,
            },
            committer: {
              name: data.commit.committer.name,
              email: data.commit.committer.email,
              date: data.commit.committer.date,
            },
            html_url: data.commit.html_url,
          },
        },
      },
    }
  },

  outputs: {
    content: { type: 'string', description: 'Human-readable file creation confirmation' },
    metadata: {
      type: 'object',
      description: 'File and commit metadata',
      properties: {
        file: {
          type: 'object',
          description: 'Created file information',
          properties: {
            name: { type: 'string', description: 'File name' },
            path: { type: 'string', description: 'Full path in repository' },
            sha: { type: 'string', description: 'Git blob SHA' },
            size: { type: 'number', description: 'File size in bytes' },
            type: { type: 'string', description: 'Content type' },
            download_url: { type: 'string', description: 'Direct download URL' },
            html_url: { type: 'string', description: 'GitHub web UI URL' },
          },
        },
        commit: {
          type: 'object',
          description: 'Commit information',
          properties: {
            sha: { type: 'string', description: 'Commit SHA' },
            message: { type: 'string', description: 'Commit message' },
            author: {
              type: 'object',
              description: 'Author information',
            },
            committer: {
              type: 'object',
              description: 'Committer information',
            },
            html_url: { type: 'string', description: 'Commit URL' },
          },
        },
      },
    },
  },
}
