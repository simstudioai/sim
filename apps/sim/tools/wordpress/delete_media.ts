import type { ToolConfig } from '@/tools/types'
import {
  WORDPRESS_COM_API_BASE,
  type WordPressDeleteMediaParams,
  type WordPressDeleteMediaResponse,
} from '@/tools/wordpress/types'

export const deleteMediaTool: ToolConfig<WordPressDeleteMediaParams, WordPressDeleteMediaResponse> =
  {
    id: 'wordpress_delete_media',
    name: 'WordPress Delete Media',
    description: 'Delete a media item from WordPress.com',
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
        description: 'The ID of the media item to delete',
      },
      force: {
        type: 'boolean',
        required: false,
        visibility: 'user-only',
        description: 'Force delete (media has no trash, so deletion is permanent)',
      },
    },

    request: {
      url: (params) => {
        // Media deletion requires force=true to actually delete
        return `${WORDPRESS_COM_API_BASE}/${params.siteId}/media/${params.mediaId}?force=true`
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
          media: {
            id: data.id || data.previous?.id,
            date: data.date || data.previous?.date,
            slug: data.slug || data.previous?.slug,
            type: data.type || data.previous?.type,
            link: data.link || data.previous?.link,
            title: data.title || data.previous?.title,
            caption: data.caption || data.previous?.caption,
            alt_text: data.alt_text || data.previous?.alt_text,
            media_type: data.media_type || data.previous?.media_type,
            mime_type: data.mime_type || data.previous?.mime_type,
            source_url: data.source_url || data.previous?.source_url,
            media_details: data.media_details || data.previous?.media_details,
          },
        },
      }
    },

    outputs: {
      deleted: {
        type: 'boolean',
        description: 'Whether the media was deleted',
      },
      media: {
        type: 'object',
        description: 'The deleted media item',
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
