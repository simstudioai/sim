import { createLogger } from '@sim/logger'
import {
  authJsonHeaders,
  batchUpdateUrl,
  buildElementProperties,
  generateObjectId,
  presentationUrl,
} from '@/tools/google_slides/utils'
import type { ToolConfig } from '@/tools/types'

const logger = createLogger('GoogleSlidesCreateVideoTool')

interface CreateVideoParams {
  accessToken: string
  presentationId: string
  pageObjectId: string
  source: 'YOUTUBE' | 'DRIVE'
  videoId: string
  width?: number
  height?: number
  positionX?: number
  positionY?: number
}

interface CreateVideoResponse {
  success: boolean
  output: {
    videoObjectId: string
    metadata: { presentationId: string; pageObjectId: string; url: string }
  }
}

export const createVideoTool: ToolConfig<CreateVideoParams, CreateVideoResponse> = {
  id: 'google_slides_create_video',
  name: 'Embed Video in Google Slides',
  description: 'Embed a YouTube or Google Drive video on a slide.',
  version: '1.0.0',

  oauth: { required: true, provider: 'google-drive' },

  params: {
    accessToken: {
      type: 'string',
      required: true,
      visibility: 'hidden',
      description: 'The access token for the Google Slides API',
    },
    presentationId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Google Slides presentation ID',
    },
    pageObjectId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Object ID of the slide to add the video to',
    },
    source: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'YOUTUBE or DRIVE',
    },
    videoId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'YouTube video ID or Drive file ID',
    },
    width: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Width in points (default 400)',
    },
    height: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Height in points (default 225)',
    },
    positionX: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'X position in points (default 100)',
    },
    positionY: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Y position in points (default 100)',
    },
  },

  request: {
    url: (params) => batchUpdateUrl(params.presentationId),
    method: 'POST',
    headers: (params) => authJsonHeaders(params.accessToken),
    body: (params) => {
      const pageObjectId = params.pageObjectId?.trim()
      const videoId = params.videoId?.trim()
      if (!pageObjectId) throw new Error('Page Object ID is required')
      if (!videoId) throw new Error('Video ID is required')
      if (!params.source) throw new Error('Source is required (YOUTUBE or DRIVE)')

      const objectId = generateObjectId('video')
      const elementProperties = buildElementProperties({
        pageObjectId,
        width: params.width,
        height: params.height,
        positionX: params.positionX,
        positionY: params.positionY,
        defaultWidth: 400,
        defaultHeight: 225,
      })

      return {
        requests: [
          {
            createVideo: {
              objectId,
              source: params.source,
              id: videoId,
              elementProperties,
            },
          },
        ],
      }
    },
  },

  transformResponse: async (response: Response, params) => {
    const data = await response.json()
    if (!response.ok) {
      logger.error('Google Slides API error:', { data })
      throw new Error(data.error?.message || 'Failed to create video')
    }
    const videoObjectId = data.replies?.[0]?.createVideo?.objectId ?? ''
    const presentationId = params?.presentationId?.trim() || ''
    const pageObjectId = params?.pageObjectId?.trim() || ''
    return {
      success: true,
      output: {
        videoObjectId,
        metadata: { presentationId, pageObjectId, url: presentationUrl(presentationId) },
      },
    }
  },

  outputs: {
    videoObjectId: { type: 'string', description: 'Object ID of the inserted video' },
    metadata: {
      type: 'object',
      description: 'Operation metadata',
      properties: {
        presentationId: { type: 'string', description: 'The presentation ID' },
        pageObjectId: { type: 'string', description: 'The slide ID' },
        url: { type: 'string', description: 'URL to the presentation' },
      },
    },
  },
}
