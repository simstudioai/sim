import type {
  GoogleMapsDistanceMatrixParams,
  GoogleMapsDistanceMatrixResponse,
} from '@/tools/google_maps/types'
import type { ToolConfig } from '@/tools/types'

export const googleMapsDistanceMatrixTool: ToolConfig<
  GoogleMapsDistanceMatrixParams,
  GoogleMapsDistanceMatrixResponse
> = {
  id: 'google_maps_distance_matrix',
  name: 'Google Maps Distance Matrix',
  description: 'Calculate travel distance and time between multiple origins and destinations',
  version: '1.0.0',

  params: {
    apiKey: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'Google Maps API key',
    },
    origin: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Origin location (address or lat,lng)',
    },
    destinations: {
      type: 'json',
      required: true,
      visibility: 'user-or-llm',
      description: 'Array of destination locations',
    },
    mode: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Travel mode: driving, walking, bicycling, or transit',
    },
    avoid: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Features to avoid: tolls, highways, or ferries',
    },
    units: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Unit system: metric or imperial',
    },
    language: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Language code for results (e.g., en, es, fr)',
    },
  },

  request: {
    url: (params) => {
      const url = new URL('https://maps.googleapis.com/maps/api/distancematrix/json')
      url.searchParams.set('origins', params.origin.trim())
      url.searchParams.set('destinations', params.destinations.join('|'))
      url.searchParams.set('key', params.apiKey.trim())

      if (params.mode) {
        url.searchParams.set('mode', params.mode)
      }
      if (params.avoid) {
        url.searchParams.set('avoid', params.avoid)
      }
      if (params.units) {
        url.searchParams.set('units', params.units)
      }
      if (params.language) {
        url.searchParams.set('language', params.language.trim())
      }

      return url.toString()
    },
    method: 'GET',
    headers: () => ({
      'Content-Type': 'application/json',
    }),
  },

  transformResponse: async (response: Response) => {
    const data = await response.json()

    if (data.status !== 'OK') {
      throw new Error(
        `Distance matrix request failed: ${data.status} - ${data.error_message || 'Unknown error'}`
      )
    }

    const rows = data.rows.map(
      (row: {
        elements: Array<{
          distance?: { text: string; value: number }
          duration?: { text: string; value: number }
          duration_in_traffic?: { text: string; value: number }
          status: string
        }>
      }) => ({
        elements: row.elements.map((element) => ({
          distanceText: element.distance?.text ?? 'N/A',
          distanceMeters: element.distance?.value ?? 0,
          durationText: element.duration?.text ?? 'N/A',
          durationSeconds: element.duration?.value ?? 0,
          durationInTrafficText: element.duration_in_traffic?.text ?? null,
          durationInTrafficSeconds: element.duration_in_traffic?.value ?? null,
          status: element.status,
        })),
      })
    )

    return {
      success: true,
      output: {
        originAddresses: data.origin_addresses ?? [],
        destinationAddresses: data.destination_addresses ?? [],
        rows,
      },
    }
  },

  outputs: {
    originAddresses: {
      type: 'array',
      description: 'Resolved origin addresses',
      items: {
        type: 'string',
      },
    },
    destinationAddresses: {
      type: 'array',
      description: 'Resolved destination addresses',
      items: {
        type: 'string',
      },
    },
    rows: {
      type: 'array',
      description: 'Distance matrix rows (one per origin)',
      items: {
        type: 'object',
        properties: {
          elements: {
            type: 'array',
            description: 'Elements (one per destination)',
            items: {
              type: 'object',
              properties: {
                distanceText: { type: 'string', description: 'Distance as text (e.g., "5.2 km")' },
                distanceMeters: { type: 'number', description: 'Distance in meters' },
                durationText: { type: 'string', description: 'Duration as text (e.g., "15 mins")' },
                durationSeconds: { type: 'number', description: 'Duration in seconds' },
                durationInTrafficText: {
                  type: 'string',
                  description: 'Duration in traffic as text',
                  optional: true,
                },
                durationInTrafficSeconds: {
                  type: 'number',
                  description: 'Duration in traffic in seconds',
                  optional: true,
                },
                status: {
                  type: 'string',
                  description: 'Element status (OK, NOT_FOUND, ZERO_RESULTS)',
                },
              },
            },
          },
        },
      },
    },
  },
}
