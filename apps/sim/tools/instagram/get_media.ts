import { INSTAGRAM_CHILD_MEDIA_PROPERTIES } from '@/tools/instagram/output-properties'
import type { InstagramGetMediaParams, InstagramGetMediaResponse } from '@/tools/instagram/types'
import {
  bearerHeaders,
  graphUrl,
  type InstagramGraphPage,
  idString,
  readGraphError,
  readGraphJson,
} from '@/tools/instagram/utils'
import type { ToolConfig } from '@/tools/types'

const MEDIA_FIELDS =
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
    },

    request: {
      url: (params) => graphUrl(`/${params.mediaId.trim()}`, { fields: MEDIA_FIELDS }),
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

      const data = await readGraphJson<{
        id?: string | number
        caption?: string
        media_type?: string
        media_product_type?: string
        media_url?: string
        permalink?: string
        timestamp?: string
        like_count?: number
        comments_count?: number
        children?: InstagramGraphPage<{ id?: unknown }>
      }>(response, 'Instagram media response')
      const children = Array.isArray(data.children?.data)
        ? data.children.data.flatMap((child: { id?: unknown }) => {
            const id = idString(child.id)
            return id ? [{ id }] : []
          })
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
      mediaUrl: {
        type: 'string',
        description: 'Temporary CDN URL; use Download Media for a durable User File',
        optional: true,
      },
      permalink: { type: 'string', description: 'Permalink to the post', optional: true },
      timestamp: { type: 'string', description: 'ISO timestamp', optional: true },
      likeCount: { type: 'number', description: 'Like count', optional: true },
      commentsCount: { type: 'number', description: 'Comments count', optional: true },
      children: {
        type: 'array',
        description: 'Carousel child media IDs',
        items: { type: 'object', properties: INSTAGRAM_CHILD_MEDIA_PROPERTIES },
      },
    },
  }
