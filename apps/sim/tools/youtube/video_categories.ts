import type { ToolConfig } from '@/tools/types'
import type {
  YouTubeVideoCategoriesParams,
  YouTubeVideoCategoriesResponse,
} from '@/tools/youtube/types'

export const youtubeVideoCategoriesTool: ToolConfig<
  YouTubeVideoCategoriesParams,
  YouTubeVideoCategoriesResponse
> = {
  id: 'youtube_video_categories',
  name: 'YouTube Video Categories',
  description:
    'Get a list of video categories available on YouTube. Use this to discover valid category IDs for filtering search and trending results.',
  version: '1.0.0',
  params: {
    regionCode: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        'ISO 3166-1 alpha-2 country code to get categories for (e.g., "US", "GB", "JP"). Defaults to US.',
    },
    hl: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Language for category titles (ISO 639-1 code, e.g., "en", "es", "fr"). Defaults to English.',
    },
    apiKey: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'YouTube API Key',
    },
  },

  request: {
    url: (params: YouTubeVideoCategoriesParams) => {
      let url = `https://www.googleapis.com/youtube/v3/videoCategories?part=snippet&key=${params.apiKey}`
      url += `&regionCode=${params.regionCode || 'US'}`
      if (params.hl) {
        url += `&hl=${params.hl}`
      }
      return url
    },
    method: 'GET',
    headers: () => ({
      'Content-Type': 'application/json',
    }),
  },

  transformResponse: async (response: Response): Promise<YouTubeVideoCategoriesResponse> => {
    const data = await response.json()

    if (data.error) {
      return {
        success: false,
        output: {
          items: [],
          totalResults: 0,
        },
        error: data.error.message || 'Failed to fetch video categories',
      }
    }

    const items = (data.items || [])
      .filter((item: any) => item.snippet?.assignable !== false)
      .map((item: any) => ({
        categoryId: item.id ?? '',
        title: item.snippet?.title ?? '',
        assignable: item.snippet?.assignable ?? false,
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
      description: 'Array of video categories available in the specified region',
      items: {
        type: 'object',
        properties: {
          categoryId: {
            type: 'string',
            description: 'Category ID to use in search/trending filters (e.g., "10" for Music)',
          },
          title: { type: 'string', description: 'Human-readable category name' },
          assignable: {
            type: 'boolean',
            description: 'Whether videos can be tagged with this category',
          },
        },
      },
    },
    totalResults: {
      type: 'number',
      description: 'Total number of categories available',
    },
  },
}
