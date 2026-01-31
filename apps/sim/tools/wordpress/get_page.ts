import type { ToolConfig } from '@/tools/types'
import {
  WORDPRESS_COM_API_BASE,
  type WordPressGetPageParams,
  type WordPressGetPageResponse,
} from '@/tools/wordpress/types'

export const getPageTool: ToolConfig<WordPressGetPageParams, WordPressGetPageResponse> = {
  id: 'wordpress_get_page',
  name: 'WordPress Get Page',
  description: 'Get a single page from WordPress.com by ID',
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
    pageId: {
      type: 'number',
      required: true,
      visibility: 'user-or-llm',
      description: 'The ID of the page to retrieve',
    },
  },

  request: {
    url: (params) => `${WORDPRESS_COM_API_BASE}/${params.siteId}/pages/${params.pageId}`,
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
        page: {
          id: data.id,
          date: data.date,
          modified: data.modified,
          slug: data.slug,
          status: data.status,
          type: data.type,
          link: data.link,
          title: data.title,
          content: data.content,
          excerpt: data.excerpt,
          author: data.author,
          featured_media: data.featured_media,
          parent: data.parent,
          menu_order: data.menu_order,
        },
      },
    }
  },

  outputs: {
    page: {
      type: 'object',
      description: 'The retrieved page',
      properties: {
        id: { type: 'number', description: 'Page ID' },
        date: { type: 'string', description: 'Page creation date' },
        modified: { type: 'string', description: 'Page modification date' },
        slug: { type: 'string', description: 'Page slug' },
        status: { type: 'string', description: 'Page status' },
        type: { type: 'string', description: 'Content type' },
        link: { type: 'string', description: 'Page URL' },
        title: { type: 'object', description: 'Page title object' },
        content: { type: 'object', description: 'Page content object' },
        excerpt: { type: 'object', description: 'Page excerpt object' },
        author: { type: 'number', description: 'Author ID' },
        featured_media: { type: 'number', description: 'Featured media ID' },
        parent: { type: 'number', description: 'Parent page ID' },
        menu_order: { type: 'number', description: 'Menu order' },
      },
    },
  },
}
