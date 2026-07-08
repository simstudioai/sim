import type { GoogleMapsPollenParams, GoogleMapsPollenResponse } from '@/tools/google_maps/types'
import type { ToolConfig } from '@/tools/types'

interface RawIndexInfo {
  code?: string
  displayName?: string
  value?: number
  category?: string
  indexDescription?: string
  color?: { red?: number; green?: number; blue?: number }
}

const mapIndexInfo = (indexInfo: RawIndexInfo | undefined) =>
  indexInfo
    ? {
        code: indexInfo.code || '',
        displayName: indexInfo.displayName || '',
        value: indexInfo.value ?? 0,
        category: indexInfo.category || '',
        indexDescription: indexInfo.indexDescription || '',
        color: {
          red: indexInfo.color?.red ?? 0,
          green: indexInfo.color?.green ?? 0,
          blue: indexInfo.color?.blue ?? 0,
        },
      }
    : null

export const googleMapsPollenTool: ToolConfig<GoogleMapsPollenParams, GoogleMapsPollenResponse> = {
  id: 'google_maps_pollen',
  name: 'Google Maps Pollen',
  description: 'Get a daily pollen forecast (grass, tree, weed) for a location',
  version: '1.0.0',

  params: {
    apiKey: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'Google Maps API key with Pollen API enabled',
    },
    lat: {
      type: 'number',
      required: true,
      visibility: 'user-or-llm',
      description: 'Latitude coordinate',
    },
    lng: {
      type: 'number',
      required: true,
      visibility: 'user-or-llm',
      description: 'Longitude coordinate',
    },
    days: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Number of forecast days to return (1-5, defaults to 1)',
    },
    languageCode: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Language code for the response (e.g., "en", "es")',
    },
    plantsDescription: {
      type: 'boolean',
      required: false,
      visibility: 'user-or-llm',
      description: 'Include detailed plant descriptions (defaults to true)',
    },
  },

  hosting: {
    envKeyPrefix: 'GOOGLE_CLOUD_API_KEY',
    apiKeyParam: 'apiKey',
    byokProviderId: 'google_cloud',
    pricing: {
      type: 'per_request',
      cost: 0.005,
    },
    rateLimit: {
      mode: 'per_request',
      requestsPerMinute: 60,
    },
  },

  request: {
    url: (params) => {
      const url = new URL('https://pollen.googleapis.com/v1/forecast:lookup')
      url.searchParams.set('location.latitude', params.lat.toString())
      url.searchParams.set('location.longitude', params.lng.toString())
      const rawDays =
        typeof params.days === 'number' && Number.isFinite(params.days)
          ? Math.trunc(params.days)
          : 1
      const days = Math.min(Math.max(rawDays, 1), 5)
      url.searchParams.set('days', days.toString())
      if (params.languageCode) {
        url.searchParams.set('languageCode', params.languageCode.trim())
      }
      if (params.plantsDescription !== undefined) {
        url.searchParams.set('plantsDescription', String(params.plantsDescription))
      }
      url.searchParams.set('key', params.apiKey.trim())
      return url.toString()
    },
    method: 'GET',
    headers: () => ({
      'Content-Type': 'application/json',
    }),
  },

  transformResponse: async (response: Response) => {
    const data = await response.json()

    if (!response.ok || data.error) {
      throw new Error(`Pollen lookup failed: ${data.error?.message || response.statusText}`)
    }

    const dailyInfo = (data.dailyInfo || []).map(
      (day: {
        date?: { year?: number; month?: number; day?: number }
        pollenTypeInfo?: Array<{
          code?: string
          displayName?: string
          inSeason?: boolean
          indexInfo?: RawIndexInfo
          healthRecommendations?: string[]
        }>
        plantInfo?: Array<{
          code?: string
          displayName?: string
          inSeason?: boolean
          indexInfo?: RawIndexInfo
          plantDescription?: {
            type?: string
            family?: string
            season?: string
            specialColors?: string
            specialShapes?: string
            crossReaction?: string
            picture?: string
            pictureCloseup?: string
          }
        }>
      }) => ({
        date: {
          year: day.date?.year ?? 0,
          month: day.date?.month ?? 0,
          day: day.date?.day ?? 0,
        },
        pollenTypeInfo: (day.pollenTypeInfo || []).map((type) => ({
          code: type.code || '',
          displayName: type.displayName || '',
          inSeason: type.inSeason ?? null,
          indexInfo: mapIndexInfo(type.indexInfo),
          healthRecommendations: type.healthRecommendations || [],
        })),
        plantInfo: (day.plantInfo || []).map((plant) => ({
          code: plant.code || '',
          displayName: plant.displayName || '',
          inSeason: plant.inSeason ?? null,
          indexInfo: mapIndexInfo(plant.indexInfo),
          plantDescription: plant.plantDescription
            ? {
                type: plant.plantDescription.type || '',
                family: plant.plantDescription.family || '',
                season: plant.plantDescription.season || '',
                specialColors: plant.plantDescription.specialColors || '',
                specialShapes: plant.plantDescription.specialShapes || '',
                crossReaction: plant.plantDescription.crossReaction || '',
                picture: plant.plantDescription.picture || '',
                pictureCloseup: plant.plantDescription.pictureCloseup || '',
              }
            : null,
        })),
      })
    )

    return {
      success: true,
      output: {
        regionCode: data.regionCode || '',
        dailyInfo,
      },
    }
  },

  outputs: {
    regionCode: {
      type: 'string',
      description: 'Region code (ISO 3166-1 alpha-2) for the location',
    },
    dailyInfo: {
      type: 'array',
      description: 'Daily pollen forecast entries',
      items: {
        type: 'object',
        properties: {
          date: {
            type: 'object',
            description: 'Calendar date of the forecast entry',
            properties: {
              year: { type: 'number' },
              month: { type: 'number' },
              day: { type: 'number' },
            },
          },
          pollenTypeInfo: {
            type: 'array',
            description: 'Pollen type indices (grass, tree, weed)',
            items: {
              type: 'object',
              properties: {
                code: { type: 'string', description: 'Pollen type code (GRASS, TREE, WEED)' },
                displayName: { type: 'string', description: 'Display name' },
                inSeason: { type: 'boolean', description: 'Whether the pollen type is in season' },
                indexInfo: { type: 'object', description: 'Universal Pollen Index (UPI) info' },
                healthRecommendations: {
                  type: 'array',
                  description: 'Health recommendations',
                  items: { type: 'string' },
                },
              },
            },
          },
          plantInfo: {
            type: 'array',
            description: 'Per-plant forecast with descriptions',
            items: {
              type: 'object',
              properties: {
                code: { type: 'string', description: 'Plant code (e.g., BIRCH, RAGWEED)' },
                displayName: { type: 'string', description: 'Display name' },
                inSeason: { type: 'boolean', description: 'Whether the plant is in season' },
                indexInfo: { type: 'object', description: 'Universal Pollen Index (UPI) info' },
                plantDescription: {
                  type: 'object',
                  description: 'Plant details (type, family, season, cross-reactions)',
                },
              },
            },
          },
        },
      },
    },
  },
}
