import type { ToolConfig } from '@/tools/types'
import {
  WORDPRESS_COM_API_BASE,
  type WordPressUpdateTagParams,
  type WordPressUpdateTagResponse,
} from '@/tools/wordpress/types'

export const updateTagTool: ToolConfig<WordPressUpdateTagParams, WordPressUpdateTagResponse> = {
  id: 'wordpress_update_tag',
  name: 'WordPress Update Tag',
  description: 'Update an existing tag in WordPress.com',
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
      description: 'The ID of the tag to update',
    },
    name: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Tag name',
    },
    description: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Tag description',
    },
    slug: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'URL slug for the tag',
    },
  },

  request: {
    url: (params) => `${WORDPRESS_COM_API_BASE}/${params.siteId}/tags/${params.tagId}`,
    method: 'POST',
    headers: (params) => ({
      'Content-Type': 'application/json',
      Authorization: `Bearer ${params.accessToken}`,
    }),
    body: (params) => {
      const body: Record<string, any> = {}

      if (params.name) body.name = params.name
      if (params.description !== undefined) body.description = params.description
      if (params.slug) body.slug = params.slug

      return body
    },
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
      description: 'The updated tag',
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
