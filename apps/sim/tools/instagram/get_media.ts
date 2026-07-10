import type { InstagramGetMediaParams, InstagramGetMediaResponse } from '@/tools/instagram/types'
import { bearerHeaders, graphUrl, idString, readGraphError } from '@/tools/instagram/utils'
import type { ToolConfig } from '@/tools/types'

const DEFAULT_FIELDS =
  'id,caption,media_type,media_product_type,media_url,permalink,timestamp,like_count,comments_count,children{id}'

export const instagramGetMediaTool: ToolConfig<InstagramGetMediaParams, InstagramGetMediaResponse> =
  {
    id: 'instagram_get_media',
    name: 'Instagram Get Media',
    description: 'Get details for a specific Instagram media object',
    version: '1.0.0',

    oauth: {
      required: true,
      provider: 'instagram',
    },

    params: {
      accessToken: {
        type: 'string',
        required: true,
        visibility: 'hidden',
        description: 'Access token for Instagram API',
      },
      mediaId: {
        type: 'string',
        required: true,
        visibility: 'user-or-llm',
        description: 'Instagram media id',
      },
      fields: {
        type: 'string',
        required: false,
        visibility: 'user-or-llm',
        description: 'Comma-separated fields to request',
      },
    },

    request: {
      url: (params) =>
        graphUrl(`/${params.mediaId.trim()}`, { fields: params.fields || DEFAULT_FIELDS }),
      method: 'GET',
      headers: (params) => bearerHeaders(params.accessToken),
    },

    transformResponse: async (response): Promise<InstagramGetMediaResponse> => {
      if (!response.ok) {
        return {
          success: false,
          output: {
            id: null,
            caption: null,
            mediaType: null,
            mediaProductType: null,
            mediaUrl: null,
            permalink: null,
            timestamp: null,
            likeCount: null,
            commentsCount: null,
            children: [],
          },
          error: await readGraphError(response),
        }
      }

      const data = await response.json()
      const children = Array.isArray(data.children?.data)
        ? data.children.data.map((child: { id?: string }) => ({ id: String(child.id ?? '') }))
        : []

      return {
        success: true,
        output: {
          id: idString(data.id),
          caption: data.caption ?? null,
          mediaType: data.media_type ?? null,
          mediaProductType: data.media_product_type ?? null,
          mediaUrl: data.media_url ?? null,
          permalink: data.permalink ?? null,
          timestamp: data.timestamp ?? null,
          likeCount: data.like_count ?? null,
          commentsCount: data.comments_count ?? null,
          children,
        },
      }
    },

    outputs: {
      id: { type: 'string', description: 'Media id', optional: true },
      caption: { type: 'string', description: 'Caption text', optional: true },
      mediaType: { type: 'string', description: 'IMAGE, VIDEO, or CAROUSEL_ALBUM', optional: true },
      mediaProductType: {
        type: 'string',
        description: 'Feed, Reels, or Stories product type',
        optional: true,
      },
      mediaUrl: { type: 'string', description: 'CDN media URL when available', optional: true },
      permalink: { type: 'string', description: 'Permalink to the post', optional: true },
      timestamp: { type: 'string', description: 'ISO timestamp', optional: true },
      likeCount: { type: 'number', description: 'Like count', optional: true },
      commentsCount: { type: 'number', description: 'Comments count', optional: true },
      children: { type: 'json', description: 'Carousel child media ids' },
    },
  }
