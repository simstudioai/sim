import type {
  DropboxListSharedLinksParams,
  DropboxListSharedLinksResponse,
} from '@/tools/dropbox/types'
import type { ToolConfig } from '@/tools/types'

export const dropboxListSharedLinksTool: ToolConfig<
  DropboxListSharedLinksParams,
  DropboxListSharedLinksResponse
> = {
  id: 'dropbox_list_shared_links',
  name: 'Dropbox List Shared Links',
  description: 'List shared links for a path, or for the entire account if no path is given',
  version: '1.0.0',

  oauth: {
    required: true,
    provider: 'dropbox',
  },

  params: {
    path: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Path to list shared links for. If omitted, lists all shared links.',
    },
    directOnly: {
      type: 'boolean',
      required: false,
      visibility: 'user-only',
      description: 'If true, only return links directly to the path, not parent folder links',
    },
    cursor: {
      type: 'string',
      required: false,
      visibility: 'user-only',
      description: 'Cursor from a previous call to fetch the next page of results',
    },
  },

  request: {
    url: 'https://api.dropboxapi.com/2/sharing/list_shared_links',
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
      const body: Record<string, any> = {}
      if (params.path) {
        const trimmedPath = params.path.trim()
        // Dropbox only returns every shared link on the account when `path` is omitted
        // entirely; sending "" scopes the results to the root folder instead. Since our UI
        // tells users "/" means "list all links", omit the field rather than sending "".
        if (trimmedPath !== '/' && trimmedPath !== '') {
          body.path = trimmedPath
        }
      }
      if (params.directOnly !== undefined) body.direct_only = params.directOnly
      if (params.cursor) body.cursor = params.cursor
      return body
    },
  },

  transformResponse: async (response) => {
    const data = await response.json()

    if (!response.ok) {
      return {
        success: false,
        error: data.error_summary || data.error?.message || 'Failed to list shared links',
        output: {},
      }
    }

    return {
      success: true,
      output: {
        links: data.links ?? [],
        hasMore: data.has_more ?? false,
        cursor: data.cursor,
      },
    }
  },

  outputs: {
    links: {
      type: 'array',
      description: 'Shared links applicable to the path argument',
      items: {
        type: 'object',
        properties: {
          '.tag': { type: 'string', description: 'Type: file or folder' },
          url: { type: 'string', description: 'The shared link URL' },
          name: { type: 'string', description: 'Name of the shared item' },
          path_lower: {
            type: 'string',
            description: 'Lowercase path of the shared item',
            optional: true,
          },
          expires: { type: 'string', description: 'Expiration date if set' },
        },
      },
    },
    hasMore: {
      type: 'boolean',
      description: 'Whether there are more results',
    },
    cursor: {
      type: 'string',
      description: 'Cursor for pagination (only returned when no path is given)',
    },
  },
}
