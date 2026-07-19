import type { ToolConfig } from '@/tools/types'
import {
  WORDPRESS_COM_API_BASE,
  type WordPressGetTagParams,
  type WordPressGetTagResponse,
} from '@/tools/wordpress/types'

export const getTagTool: ToolConfig<WordPressGetTagParams, WordPressGetTagResponse> = {
  id: 'wordpress_get_tag',
  name: 'WordPress Get Tag',
  description: 'Get a single tag from WordPress.com by ID',
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
      description: 'The ID of the tag to retrieve',
    },
  },

  request: {
    url: (params) => `${WORDPRESS_COM_API_BASE}/${params.siteId}/tags/${params.tagId}`,
    method: 'GET',
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
        tag: {
          id: data.id,
          count: data.count,
          description: data.description,
          link: data.link,
          name: data.name,
          slug: data.slug,
          taxonomy: data.taxonomy,
        },
      },
    }
  },

  outputs: {
    tag: {
      type: 'object',
      description: 'The retrieved tag',
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
