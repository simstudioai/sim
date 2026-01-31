import type { ToolConfig } from '@/tools/types'
import {
  WORDPRESS_COM_API_BASE,
  type WordPressDeletePageParams,
  type WordPressDeletePageResponse,
} from '@/tools/wordpress/types'

export const deletePageTool: ToolConfig<WordPressDeletePageParams, WordPressDeletePageResponse> = {
  id: 'wordpress_delete_page',
  name: 'WordPress Delete Page',
  description: 'Delete a page from WordPress.com',
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
      description: 'The ID of the page to delete',
    },
    force: {
      type: 'boolean',
      required: false,
      visibility: 'user-only',
      description: 'Bypass trash and force delete permanently',
    },
  },

  request: {
    url: (params) => {
      const forceParam = params.force ? '?force=true' : ''
      return `${WORDPRESS_COM_API_BASE}/${params.siteId}/pages/${params.pageId}${forceParam}`
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
        deleted: data.deleted || true,
        page: {
          id: data.id || data.previous?.id,
          date: data.date || data.previous?.date,
          modified: data.modified || data.previous?.modified,
          slug: data.slug || data.previous?.slug,
          status: data.status || data.previous?.status || 'trash',
          type: data.type || data.previous?.type,
          link: data.link || data.previous?.link,
          title: data.title || data.previous?.title,
          content: data.content || data.previous?.content,
          excerpt: data.excerpt || data.previous?.excerpt,
          author: data.author || data.previous?.author,
          featured_media: data.featured_media || data.previous?.featured_media,
          parent: data.parent || data.previous?.parent,
          menu_order: data.menu_order || data.previous?.menu_order,
        },
      },
    }
  },

  outputs: {
    deleted: {
      type: 'boolean',
      description: 'Whether the page was deleted',
    },
    page: {
      type: 'object',
      description: 'The deleted page',
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
