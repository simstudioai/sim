import type { ToolConfig } from '@/tools/types'
import type { YouTubeCaptionsParams, YouTubeCaptionsResponse } from '@/tools/youtube/types'

export const youtubeCaptionsTool: ToolConfig<YouTubeCaptionsParams, YouTubeCaptionsResponse> = {
  id: 'youtube_captions',
  name: 'YouTube Captions',
  description:
    'List available caption tracks (subtitles/transcripts) for a YouTube video. Returns information about each caption including language, type, and whether it is auto-generated.',
  version: '1.0.0',
  params: {
    videoId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'YouTube video ID to get captions for',
    },
    apiKey: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'YouTube API Key',
    },
  },

  request: {
    url: (params: YouTubeCaptionsParams) => {
      return `https://www.googleapis.com/youtube/v3/captions?part=snippet&videoId=${encodeURIComponent(params.videoId)}&key=${params.apiKey}`
    },
    method: 'GET',
    headers: () => ({
      'Content-Type': 'application/json',
    }),
  },

  transformResponse: async (response: Response): Promise<YouTubeCaptionsResponse> => {
    const data = await response.json()

    if (data.error) {
      return {
        success: false,
        output: {
          items: [],
          totalResults: 0,
        },
        error: data.error.message || 'Failed to fetch captions',
      }
    }

    const items = (data.items || []).map((item: any) => ({
      captionId: item.id ?? '',
      language: item.snippet?.language ?? '',
      name: item.snippet?.name ?? '',
      trackKind: item.snippet?.trackKind ?? '',
      lastUpdated: item.snippet?.lastUpdated ?? '',
      isCC: item.snippet?.isCC ?? false,
      isAutoSynced: item.snippet?.isAutoSynced ?? false,
      audioTrackType: item.snippet?.audioTrackType ?? null,
    }))

    return {
      success: true,
      output: {
        items,
        totalResults: items.length,
      },
    }
  },

  outputs: {
    items: {
      type: 'array',
      description: 'Array of available caption tracks for the video',
      items: {
        type: 'object',
        properties: {
          captionId: { type: 'string', description: 'Caption track ID' },
          language: {
            type: 'string',
            description: 'Language code of the caption (e.g., "en", "es")',
          },
          name: { type: 'string', description: 'Name/label of the caption track' },
          trackKind: {
            type: 'string',
            description: 'Type of caption track: "standard", "ASR" (auto-generated), or "forced"',
          },
          lastUpdated: { type: 'string', description: 'When the caption was last updated' },
          isCC: { type: 'boolean', description: 'Whether this is a closed caption track' },
          isAutoSynced: {
            type: 'boolean',
            description: 'Whether the caption timing was automatically synced',
          },
          audioTrackType: {
            type: 'string',
            description: 'Type of audio track this caption is for',
            optional: true,
          },
        },
      },
    },
    totalResults: {
      type: 'number',
      description: 'Total number of caption tracks available',
    },
  },
}
