import type { ToolConfig } from '@/tools/types'
import {
  WORDPRESS_COM_API_BASE,
  type WordPressDeleteTagParams,
  type WordPressDeleteTagResponse,
} from '@/tools/wordpress/types'

export const deleteTagTool: ToolConfig<WordPressDeleteTagParams, WordPressDeleteTagResponse> = {
  id: 'wordpress_delete_tag',
  name: 'WordPress Delete Tag',
  description: 'Delete a tag from WordPress.com',
  version: '1.0.0',

  oauth: {
    required: true,
    provider: 'wordpress',
    requiredScopes: ['global'],
  },

  params: {
    siteId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'WordPress.com site ID or domain (e.g., 12345678 or mysite.wordpress.com)',
    },
    tagId: {
      type: 'number',
      required: true,
      visibility: 'user-or-llm',
      description: 'The ID of the tag to delete',
    },
  },

  request: {
    url: (params) => {
      // Terms do not support trashing, so force=true is required to delete.
      return `${WORDPRESS_COM_API_BASE}/${params.siteId}/tags/${params.tagId}?force=true`
    },
    method: 'DELETE',
    headers: (params) => ({
      'Content-Type': 'application/json',
      Authorization: `Bearer ${params.accessToken}`,
    }),
  },

  transformResponse: async (response: Response) => {
    if (!response.ok) {
      const error = await response.json().catch(() => ({}))
      throw new Error(error.message || `WordPress API error: ${response.status}`)
    }

    const data = await response.json()

    return {
      success: true,
      output: {
        deleted: data.deleted ?? true,
        tag: {
          id: data.id ?? data.previous?.id,
          count: data.count ?? data.previous?.count,
          description: data.description || data.previous?.description,
          link: data.link || data.previous?.link,
          name: data.name || data.previous?.name,
          slug: data.slug || data.previous?.slug,
          taxonomy: data.taxonomy || data.previous?.taxonomy,
        },
      },
    }
  },

  outputs: {
    deleted: {
      type: 'boolean',
      description: 'Whether the tag was deleted',
    },
    tag: {
      type: 'object',
      description: 'The deleted tag',
      properties: {
        id: { type: 'number', description: 'Tag ID' },
        count: { type: 'number', description: 'Number of posts with this tag' },
        description: { type: 'string', description: 'Tag description' },
        link: { type: 'string', description: 'Tag archive URL' },
        name: { type: 'string', description: 'Tag name' },
        slug: { type: 'string', description: 'Tag slug' },
        taxonomy: { type: 'string', description: 'Taxonomy name' },
      },
    },
  },
}
