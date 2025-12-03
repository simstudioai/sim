import type { ToolConfig } from '@/tools/types'
import type { WordPressUpdatePageParams, WordPressUpdatePageResponse } from './types'

export const updatePageTool: ToolConfig<WordPressUpdatePageParams, WordPressUpdatePageResponse> = {
  id: 'wordpress_update_page',
  name: 'WordPress Update Page',
  description: 'Update an existing page in WordPress',
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
    pageId: {
      type: 'number',
      required: true,
      visibility: 'user-or-llm',
      description: 'The ID of the page to update',
    },
    title: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Page title',
    },
    content: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Page content (HTML or plain text)',
    },
    status: {
      type: 'string',
      required: false,
      visibility: 'user-only',
      description: 'Page status: publish, draft, pending, private',
    },
    excerpt: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Page excerpt',
    },
    parent: {
      type: 'number',
      required: false,
      visibility: 'user-only',
      description: 'Parent page ID for hierarchical pages',
    },
    menuOrder: {
      type: 'number',
      required: false,
      visibility: 'user-only',
      description: 'Order in page menu',
    },
    featuredMedia: {
      type: 'number',
      required: false,
      visibility: 'user-only',
      description: 'Featured image media ID',
    },
    slug: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'URL slug for the page',
    },
  },

  request: {
    url: (params) => {
      const baseUrl = params.siteUrl.replace(/\/$/, '')
      return `${baseUrl}/wp-json/wp/v2/pages/${params.pageId}`
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
      const body: Record<string, any> = {}

      if (params.title) body.title = params.title
      if (params.content) body.content = params.content
      if (params.status) body.status = params.status
      if (params.excerpt) body.excerpt = params.excerpt
      if (params.slug) body.slug = params.slug
      if (params.parent !== undefined) body.parent = params.parent
      if (params.menuOrder !== undefined) body.menu_order = params.menuOrder
      if (params.featuredMedia) body.featured_media = params.featuredMedia

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
      description: 'The updated page',
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
