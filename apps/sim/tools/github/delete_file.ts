import type { DeleteFileParams, DeleteFileResponse } from '@/tools/github/types'
import type { ToolConfig } from '@/tools/types'

export const deleteFileTool: ToolConfig<DeleteFileParams, DeleteFileResponse> = {
  id: 'github_delete_file',
  name: 'GitHub Delete File',
  description:
    'Delete a file from a GitHub repository. Requires the file SHA. This operation cannot be undone through the API.',
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
      description: 'Path to the file to delete (e.g., "src/oldfile.ts")',
    },
    message: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Commit message for this file deletion',
    },
    sha: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'The blob SHA of the file being deleted (get from github_get_file_content)',
    },
    branch: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Branch to delete the file from (defaults to repository default branch)',
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
    method: 'DELETE',
    headers: (params) => ({
      Accept: 'application/vnd.github+json',
      Authorization: `Bearer ${params.apiKey}`,
      'X-GitHub-Api-Version': '2022-11-28',
    }),
    body: (params) => {
      const body: Record<string, any> = {
        message: params.message,
        sha: params.sha, // Required for delete
      }

      if (params.branch) {
        body.branch = params.branch
      }

      return body
    },
  },

  transformResponse: async (response) => {
    const data = await response.json()
    const content = `File deleted successfully!

Path: ${data.commit.sha ? 'File removed from repository' : 'Unknown'}
Deleted: Yes

Commit:
- SHA: ${data.commit.sha}
- Message: ${data.commit.message || 'N/A'}
- Author: ${data.commit.author?.name || 'N/A'}
- Date: ${data.commit.author?.date || 'N/A'}

View commit: ${data.commit.html_url || 'N/A'}`

    return {
      success: true,
      output: {
        content,
        metadata: {
          deleted: true,
          path: data.commit.tree?.sha || 'N/A',
          commit: {
            sha: data.commit.sha,
            message: data.commit.message || '',
            author: {
              name: data.commit.author?.name || '',
              email: data.commit.author?.email || '',
              date: data.commit.author?.date || '',
            },
            committer: {
              name: data.commit.committer?.name || '',
              email: data.commit.committer?.email || '',
              date: data.commit.committer?.date || '',
            },
            html_url: data.commit.html_url || '',
          },
        },
      },
    }
  },

  outputs: {
    content: { type: 'string', description: 'Human-readable file deletion confirmation' },
    metadata: {
      type: 'object',
      description: 'Deletion confirmation and commit metadata',
      properties: {
        deleted: { type: 'boolean', description: 'Whether the file was deleted' },
        path: { type: 'string', description: 'File path that was deleted' },
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
