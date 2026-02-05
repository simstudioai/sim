import type {
  SpotifyGetCategoriesParams,
  SpotifyGetCategoriesResponse,
} from '@/tools/spotify/types'
import type { ToolConfig } from '@/tools/types'

export const spotifyGetCategoriesTool: ToolConfig<
  SpotifyGetCategoriesParams,
  SpotifyGetCategoriesResponse
> = {
  id: 'spotify_get_categories',
  name: 'Spotify Get Categories',
  description: 'Get a list of browse categories used to tag items in Spotify.',
  version: '1.0.0',

  oauth: {
    required: true,
    provider: 'spotify',
    requiredScopes: ['user-read-private'],
  },

  params: {
    country: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'ISO 3166-1 alpha-2 country code (e.g., "US", "GB")',
    },
    locale: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Locale code (e.g., "en_US", "es_MX")',
    },
    limit: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      default: 20,
      description: 'Number of categories to return (1-50)',
    },
  },

  request: {
    url: (params) => {
      const limit = Math.min(Math.max(params.limit || 20, 1), 50)
      let url = `https://api.spotify.com/v1/browse/categories?limit=${limit}`
      if (params.country) {
        url += `&country=${params.country}`
      }
      if (params.locale) {
        url += `&locale=${params.locale}`
      }
      return url
    },
    method: 'GET',
    headers: (params) => ({
      Authorization: `Bearer ${params.accessToken}`,
      'Content-Type': 'application/json',
    }),
  },

  transformResponse: async (response): Promise<SpotifyGetCategoriesResponse> => {
    const data = await response.json()

    const categories = (data.categories?.items || []).map((category: any) => ({
      id: category.id,
      name: category.name,
      icon_url: category.icons?.[0]?.url || null,
    }))

    return {
      success: true,
      output: {
        categories,
        total: data.categories?.total || 0,
      },
    }
  },

  outputs: {
    categories: { type: 'json', description: 'List of browse categories' },
    total: { type: 'number', description: 'Total number of categories' },
  },
}
