import type { DeleteReleaseParams, DeleteReleaseResponse } from '@/tools/github/types'
import type { ToolConfig } from '@/tools/types'

export const deleteReleaseTool: ToolConfig<DeleteReleaseParams, DeleteReleaseResponse> = {
  id: 'github_delete_release',
  name: 'GitHub Delete Release',
  description:
    'Delete a GitHub release by ID. This permanently removes the release but does not delete the associated Git tag.',
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
    release_id: {
      type: 'number',
      required: true,
      visibility: 'user-or-llm',
      description: 'The unique identifier of the release to delete',
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
      `https://api.github.com/repos/${params.owner}/${params.repo}/releases/${params.release_id}`,
    method: 'DELETE',
    headers: (params) => ({
      Accept: 'application/vnd.github+json',
      Authorization: `Bearer ${params.apiKey}`,
      'X-GitHub-Api-Version': '2022-11-28',
    }),
  },

  transformResponse: async (response, params) => {
    if (!params) {
      return {
        success: false,
        error: 'Missing parameters',
        output: {
          content: '',
          metadata: {
            deleted: false,
            release_id: 0,
          },
        },
      }
    }

    if (response.status === 204) {
      const content = `Release deleted successfully
Release ID: ${params.release_id}
Repository: ${params.owner}/${params.repo}

Note: The associated Git tag has not been deleted and remains in the repository.`

      return {
        success: true,
        output: {
          content,
          metadata: {
            deleted: true,
            release_id: params.release_id,
          },
        },
      }
    }

    const data = await response.text()
    throw new Error(`Unexpected response: ${response.status} - ${data}`)
  },

  outputs: {
    content: { type: 'string', description: 'Human-readable deletion confirmation' },
    metadata: {
      type: 'object',
      description: 'Deletion result metadata',
      properties: {
        deleted: { type: 'boolean', description: 'Whether the release was successfully deleted' },
        release_id: { type: 'number', description: 'ID of the deleted release' },
      },
    },
  },
}
