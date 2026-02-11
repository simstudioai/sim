import type {
  GoogleMapsAirQualityParams,
  GoogleMapsAirQualityResponse,
} from '@/tools/google_maps/types'
import type { ToolConfig } from '@/tools/types'

export const googleMapsAirQualityTool: ToolConfig<
  GoogleMapsAirQualityParams,
  GoogleMapsAirQualityResponse
> = {
  id: 'google_maps_air_quality',
  name: 'Google Maps Air Quality',
  description: 'Get current air quality data for a location',
  version: '1.0.0',

  params: {
    apiKey: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'Google Maps API key with Air Quality API enabled',
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
    languageCode: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Language code for the response (e.g., "en", "es")',
    },
  },

  request: {
    url: (params) => {
      return `https://airquality.googleapis.com/v1/currentConditions:lookup?key=${params.apiKey.trim()}`
    },
    method: 'POST',
    headers: () => ({
      'Content-Type': 'application/json',
    }),
    body: (params) => {
      const body: {
        location: { latitude: number; longitude: number }
        extraComputations: string[]
        languageCode?: string
      } = {
        location: {
          latitude: params.lat,
          longitude: params.lng,
        },
        extraComputations: [
          'HEALTH_RECOMMENDATIONS',
          'DOMINANT_POLLUTANT_CONCENTRATION',
          'POLLUTANT_CONCENTRATION',
          'LOCAL_AQI',
          'POLLUTANT_ADDITIONAL_INFO',
        ],
      }

      if (params.languageCode) {
        body.languageCode = params.languageCode.trim()
      }

      return body
    },
  },

  transformResponse: async (response: Response) => {
    const data = await response.json()

    if (data.error) {
      throw new Error(`Air Quality failed: ${data.error.message || 'Unknown error'}`)
    }

    const indexes = (data.indexes || []).map(
      (index: {
        code: string
        displayName: string
        aqi: number
        aqiDisplay: string
        color: { red?: number; green?: number; blue?: number }
        category: string
        dominantPollutant: string
      }) => ({
        code: index.code,
        displayName: index.displayName,
        aqi: index.aqi,
        aqiDisplay: index.aqiDisplay,
        color: {
          red: index.color?.red || 0,
          green: index.color?.green || 0,
          blue: index.color?.blue || 0,
        },
        category: index.category,
        dominantPollutant: index.dominantPollutant,
      })
    )

    const pollutants = (data.pollutants || []).map(
      (pollutant: {
        code: string
        displayName: string
        fullName: string
        concentration: { value: number; units: string }
        additionalInfo?: { sources: string; effects: string }
      }) => ({
        code: pollutant.code,
        displayName: pollutant.displayName,
        fullName: pollutant.fullName,
        concentration: {
          value: pollutant.concentration?.value || 0,
          units: pollutant.concentration?.units || '',
        },
        additionalInfo: pollutant.additionalInfo
          ? {
              sources: pollutant.additionalInfo.sources,
              effects: pollutant.additionalInfo.effects,
            }
          : undefined,
      })
    )

    const healthRecs = data.healthRecommendations
    const healthRecommendations = healthRecs
      ? {
          generalPopulation: healthRecs.generalPopulation || '',
          elderly: healthRecs.elderly || '',
          lungDiseasePopulation: healthRecs.lungDiseasePopulation || '',
          heartDiseasePopulation: healthRecs.heartDiseasePopulation || '',
          athletes: healthRecs.athletes || '',
          pregnantWomen: healthRecs.pregnantWomen || '',
          children: healthRecs.children || '',
        }
      : null

    return {
      success: true,
      output: {
        dateTime: data.dateTime || '',
        regionCode: data.regionCode || '',
        indexes,
        pollutants,
        healthRecommendations,
      },
    }
  },

  outputs: {
    dateTime: {
      type: 'string',
      description: 'Timestamp of the air quality data',
    },
    regionCode: {
      type: 'string',
      description: 'Region code for the location',
    },
    indexes: {
      type: 'array',
      description: 'Array of air quality indexes',
      items: {
        type: 'object',
        properties: {
          code: { type: 'string', description: 'Index code (e.g., "uaqi", "usa_epa")' },
          displayName: { type: 'string', description: 'Display name of the index' },
          aqi: { type: 'number', description: 'Air quality index value' },
          aqiDisplay: { type: 'string', description: 'Formatted AQI display string' },
          color: {
            type: 'object',
            description: 'RGB color for the AQI level',
            properties: {
              red: { type: 'number' },
              green: { type: 'number' },
              blue: { type: 'number' },
            },
          },
          category: {
            type: 'string',
            description: 'Category description (e.g., "Good", "Moderate")',
          },
          dominantPollutant: { type: 'string', description: 'The dominant pollutant' },
        },
      },
    },
    pollutants: {
      type: 'array',
      description: 'Array of pollutant concentrations',
      items: {
        type: 'object',
        properties: {
          code: { type: 'string', description: 'Pollutant code (e.g., "pm25", "o3")' },
          displayName: { type: 'string', description: 'Display name' },
          fullName: { type: 'string', description: 'Full pollutant name' },
          concentration: {
            type: 'object',
            description: 'Concentration info',
            properties: {
              value: { type: 'number', description: 'Concentration value' },
              units: { type: 'string', description: 'Units (e.g., "PARTS_PER_BILLION")' },
            },
          },
          additionalInfo: {
            type: 'object',
            description: 'Additional info about sources and effects',
          },
        },
      },
    },
    healthRecommendations: {
      type: 'object',
      description: 'Health recommendations for different populations',
    },
  },
}
