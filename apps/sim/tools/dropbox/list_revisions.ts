import type {
  DropboxListRevisionsParams,
  DropboxListRevisionsResponse,
} from '@/tools/dropbox/types'
import type { ToolConfig } from '@/tools/types'

export const dropboxListRevisionsTool: ToolConfig<
  DropboxListRevisionsParams,
  DropboxListRevisionsResponse
> = {
  id: 'dropbox_list_revisions',
  name: 'Dropbox List Revisions',
  description: 'List the revision history for a file in Dropbox (files only, not folders)',
  version: '1.0.0',

  oauth: {
    required: true,
    provider: 'dropbox',
  },

  params: {
    path: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'The path of the file to list revisions for',
    },
    limit: {
      type: 'number',
      required: false,
      visibility: 'user-only',
      description: 'Maximum number of revisions to return, 1-100 (default: 10)',
    },
    beforeRev: {
      type: 'string',
      required: false,
      visibility: 'user-only',
      description:
        'Only return revisions before this one. Pass the rev of the last revision from a previous call to fetch the next page.',
    },
  },

  request: {
    url: 'https://api.dropboxapi.com/2/files/list_revisions',
    method: 'POST',
    headers: (params) => {
      if (!params.accessToken) {
        throw new Error('Missing access token for Dropbox API request')
      }
      return {
        Authorization: `Bearer ${params.accessToken}`,
        'Content-Type': 'application/json',
      }
    },
    body: (params) => {
      const body: Record<string, any> = {
        path: params.path.trim(),
        mode: 'path',
        limit: params.limit ?? 10,
      }
      if (params.beforeRev) {
        body.before_rev = params.beforeRev.trim()
      }
      return body
    },
  },

  transformResponse: async (response) => {
    const data = await response.json()

    if (!response.ok) {
      return {
        success: false,
        error: data.error_summary || data.error?.message || 'Failed to list revisions',
        output: {},
      }
    }

    return {
      success: true,
      output: {
        entries: data.entries || [],
        isDeleted: data.is_deleted ?? false,
        hasMore: data.has_more ?? false,
      },
    }
  },

  outputs: {
    entries: {
      type: 'array',
      description: 'The revisions for the file, most recent first',
      items: {
        type: 'object',
        properties: {
          id: { type: 'string', description: 'Unique identifier for this revision' },
          name: { type: 'string', description: 'Name of the file' },
          path_display: { type: 'string', description: 'Display path', optional: true },
          rev: { type: 'string', description: 'Revision identifier, pass to Restore' },
          size: { type: 'number', description: 'Size of this revision in bytes' },
          server_modified: { type: 'string', description: 'Server modification time' },
        },
      },
    },
    isDeleted: {
      type: 'boolean',
      description: 'Whether the file identified by the latest revision is deleted or moved',
    },
    hasMore: {
      type: 'boolean',
      description: 'Whether there are more revisions available',
    },
  },
}
