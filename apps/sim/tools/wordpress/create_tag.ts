import type { ToolConfig } from '@/tools/types'
import type { WordPressCreateTagParams, WordPressCreateTagResponse } from './types'

export const createTagTool: ToolConfig<WordPressCreateTagParams, WordPressCreateTagResponse> = {
  id: 'wordpress_create_tag',
  name: 'WordPress Create Tag',
  description: 'Create a new tag in WordPress',
  version: '1.0.0',

  params: {
    siteUrl: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'WordPress site URL (e.g., https://example.com)',
    },
    username: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'WordPress username',
    },
    applicationPassword: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'WordPress Application Password',
    },
    name: {
      type: 'string',
      required: true,
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
    url: (params) => {
      const baseUrl = params.siteUrl.replace(/\/$/, '')
      return `${baseUrl}/wp-json/wp/v2/tags`
    },
    method: 'POST',
    headers: (params) => {
      const credentials = Buffer.from(`${params.username}:${params.applicationPassword}`).toString(
        'base64'
      )
      return {
        'Content-Type': 'application/json',
        Authorization: `Basic ${credentials}`,
      }
    },
    body: (params) => {
      const body: Record<string, any> = {
        name: params.name,
      }

      if (params.description) body.description = params.description
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
      description: 'The created tag',
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
