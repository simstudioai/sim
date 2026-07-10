import type {
  InstagramPublishCarouselParams,
  InstagramPublishResponse,
} from '@/tools/instagram/types'
import {
  createMediaContainer,
  parseCommaSeparated,
  publishMediaContainer,
  resolveIgUserId,
  waitForContainerReady,
} from '@/tools/instagram/utils'
import type { ToolConfig } from '@/tools/types'

/**
 * Parse media URL entries. Prefix with `video:` for video items, otherwise treated as images.
 * Example: `https://cdn.example.com/a.jpg,video:https://cdn.example.com/b.mp4`
 */
function parseCarouselItems(mediaUrls: string): Array<{ type: 'image' | 'video'; url: string }> {
  return parseCommaSeparated(mediaUrls).map((entry) => {
    if (entry.toLowerCase().startsWith('video:')) {
      return { type: 'video' as const, url: entry.slice('video:'.length).trim() }
    }
    return { type: 'image' as const, url: entry }
  })
}

export const instagramPublishCarouselTool: ToolConfig<
  InstagramPublishCarouselParams,
  InstagramPublishResponse
> = {
  id: 'instagram_publish_carousel',
  name: 'Instagram Publish Carousel',
  description: 'Publish a carousel of up to 10 images/videos from public URLs',
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
    igUserId: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Instagram professional account user id (defaults to /me)',
    },
    mediaUrls: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description:
        'Comma-separated public media URLs (max 10). Prefix video URLs with video: (e.g. https://.../a.jpg,video:https://.../b.mp4)',
    },
    caption: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Carousel caption',
    },
  },

  request: {
    url: () => 'https://graph.instagram.com/v22.0/me?fields=user_id',
    method: 'GET',
    headers: (params) => ({ Authorization: `Bearer ${params.accessToken}` }),
  },

  postProcess: async (result, params) => {
    if (!result.success) {
      return {
        success: false,
        output: { containerId: null, mediaId: null, statusCode: null },
        error: result.error || 'Failed to resolve Instagram account',
      }
    }

    const items = parseCarouselItems(params.mediaUrls)
    if (items.length === 0) {
      return {
        success: false,
        output: { containerId: null, mediaId: null, statusCode: null },
        error: 'Provide at least one media URL',
      }
    }
    if (items.length > 10) {
      return {
        success: false,
        output: { containerId: null, mediaId: null, statusCode: null },
        error: 'Carousels support a maximum of 10 items',
      }
    }

    try {
      const igUserId = await resolveIgUserId(params.accessToken, params.igUserId)
      const childIds: string[] = []

      for (const item of items) {
        const childBody: Record<string, unknown> = {
          is_carousel_item: true,
        }
        if (item.type === 'video') {
          childBody.media_type = 'VIDEO'
          childBody.video_url = item.url
        } else {
          childBody.image_url = item.url
        }

        const childId = await createMediaContainer(params.accessToken, igUserId, childBody)
        await waitForContainerReady(params.accessToken, childId)
        childIds.push(childId)
      }

      const parentBody: Record<string, unknown> = {
        media_type: 'CAROUSEL',
        children: childIds.join(','),
      }
      if (params.caption) parentBody.caption = params.caption

      const containerId = await createMediaContainer(params.accessToken, igUserId, parentBody)
      const { statusCode } = await waitForContainerReady(params.accessToken, containerId)
      const mediaId = await publishMediaContainer(params.accessToken, igUserId, containerId)

      return {
        success: true,
        output: { containerId, mediaId, statusCode },
      }
    } catch (error) {
      return {
        success: false,
        output: { containerId: null, mediaId: null, statusCode: null },
        error: error instanceof Error ? error.message : 'Failed to publish carousel',
      }
    }
  },

  transformResponse: async (response) => {
    if (!response.ok) {
      return {
        success: false,
        output: { containerId: null, mediaId: null, statusCode: null },
        error: `Failed to resolve Instagram account: ${response.statusText}`,
      }
    }
    return {
      success: true,
      output: { containerId: null, mediaId: null, statusCode: null },
    }
  },

  outputs: {
    containerId: { type: 'string', description: 'Carousel container id', optional: true },
    mediaId: { type: 'string', description: 'Published media id', optional: true },
    statusCode: { type: 'string', description: 'Final status', optional: true },
  },
}
