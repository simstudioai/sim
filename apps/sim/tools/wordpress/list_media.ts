import type { ToolConfig } from '@/tools/types'
import {
  WORDPRESS_COM_API_BASE,
  type WordPressListMediaParams,
  type WordPressListMediaResponse,
} from '@/tools/wordpress/types'

export const listMediaTool: ToolConfig<WordPressListMediaParams, WordPressListMediaResponse> = {
  id: 'wordpress_list_media',
  name: 'WordPress List Media',
  description: 'List media items from the WordPress.com media library',
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
    perPage: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Number of media items per request (e.g., 10, 25, 50). Default: 10, max: 100',
    },
    page: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Page number for pagination (e.g., 1, 2, 3)',
    },
    search: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Search term to filter media (e.g., "logo", "banner")',
    },
    mediaType: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Filter by media type: image, video, audio, application',
    },
    mimeType: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Filter by specific MIME type (e.g., image/jpeg, image/png)',
    },
    orderBy: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Order by field: date, id, title, slug',
    },
    order: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Order direction: asc or desc',
    },
  },

  request: {
    url: (params) => {
      const queryParams = new URLSearchParams()

      if (params.perPage) queryParams.append('per_page', String(params.perPage))
      if (params.page) queryParams.append('page', String(params.page))
      if (params.search) queryParams.append('search', params.search)
      if (params.mediaType) queryParams.append('media_type', params.mediaType)
      if (params.mimeType) queryParams.append('mime_type', params.mimeType)
      if (params.orderBy) queryParams.append('orderby', params.orderBy)
      if (params.order) queryParams.append('order', params.order)

      const queryString = queryParams.toString()
      return `${WORDPRESS_COM_API_BASE}/${params.siteId}/media${queryString ? `?${queryString}` : ''}`
    },
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
    const total = Number.parseInt(response.headers.get('X-WP-Total') || '0', 10)
    const totalPages = Number.parseInt(response.headers.get('X-WP-TotalPages') || '0', 10)

    return {
      success: true,
      output: {
        media: data.map((item: any) => ({
          id: item.id,
          date: item.date,
          slug: item.slug,
          type: item.type,
          link: item.link,
          title: item.title,
          caption: item.caption,
          alt_text: item.alt_text,
          media_type: item.media_type,
          mime_type: item.mime_type,
          source_url: item.source_url,
          media_details: item.media_details,
        })),
        total,
        totalPages,
      },
    }
  },

  outputs: {
    media: {
      type: 'array',
      description: 'List of media items',
      items: {
        type: 'object',
        properties: {
          id: { type: 'number', description: 'Media ID' },
          date: { type: 'string', description: 'Upload date' },
          slug: { type: 'string', description: 'Media slug' },
          type: { type: 'string', description: 'Content type' },
          link: { type: 'string', description: 'Media page URL' },
          title: { type: 'object', description: 'Media title object' },
          caption: { type: 'object', description: 'Media caption object' },
          alt_text: { type: 'string', description: 'Alt text' },
          media_type: { type: 'string', description: 'Media type (image, video, etc.)' },
          mime_type: { type: 'string', description: 'MIME type' },
          source_url: { type: 'string', description: 'Direct URL to the media file' },
          media_details: { type: 'object', description: 'Media details (dimensions, etc.)' },
        },
      },
    },
    total: {
      type: 'number',
      description: 'Total number of media items',
    },
    totalPages: {
      type: 'number',
      description: 'Total number of result pages',
    },
  },
}
