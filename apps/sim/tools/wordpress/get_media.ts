import type { ToolConfig } from '@/tools/types'
import {
  WORDPRESS_COM_API_BASE,
  type WordPressGetMediaParams,
  type WordPressGetMediaResponse,
} from '@/tools/wordpress/types'

export const getMediaTool: ToolConfig<WordPressGetMediaParams, WordPressGetMediaResponse> = {
  id: 'wordpress_get_media',
  name: 'WordPress Get Media',
  description: 'Get a single media item from WordPress.com by ID',
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
    mediaId: {
      type: 'number',
      required: true,
      visibility: 'user-or-llm',
      description: 'The ID of the media item to retrieve',
    },
  },

  request: {
    url: (params) => `${WORDPRESS_COM_API_BASE}/${params.siteId}/media/${params.mediaId}`,
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
        media: {
          id: data.id,
          date: data.date,
          slug: data.slug,
          type: data.type,
          link: data.link,
          title: data.title,
          caption: data.caption,
          alt_text: data.alt_text,
          media_type: data.media_type,
          mime_type: data.mime_type,
          source_url: data.source_url,
          media_details: data.media_details,
        },
      },
    }
  },

  outputs: {
    media: {
      type: 'object',
      description: 'The retrieved media item',
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
}
