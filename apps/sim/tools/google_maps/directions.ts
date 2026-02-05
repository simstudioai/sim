import type {
  GoogleMapsDirectionsParams,
  GoogleMapsDirectionsResponse,
} from '@/tools/google_maps/types'
import type { ToolConfig } from '@/tools/types'

export const googleMapsDirectionsTool: ToolConfig<
  GoogleMapsDirectionsParams,
  GoogleMapsDirectionsResponse
> = {
  id: 'google_maps_directions',
  name: 'Google Maps Directions',
  description: 'Get directions and route information between two locations',
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
      description: 'Starting location (address or lat,lng)',
    },
    destination: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Destination location (address or lat,lng)',
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
    waypoints: {
      type: 'json',
      required: false,
      visibility: 'user-or-llm',
      description: 'Array of intermediate waypoints',
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
      const url = new URL('https://maps.googleapis.com/maps/api/directions/json')
      url.searchParams.set('origin', params.origin.trim())
      url.searchParams.set('destination', params.destination.trim())
      url.searchParams.set('key', params.apiKey.trim())

      if (params.mode) {
        url.searchParams.set('mode', params.mode)
      }
      if (params.avoid) {
        url.searchParams.set('avoid', params.avoid)
      }
      if (params.waypoints && params.waypoints.length > 0) {
        url.searchParams.set('waypoints', params.waypoints.join('|'))
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
        `Directions request failed: ${data.status} - ${data.error_message || 'Unknown error'}`
      )
    }

    const routes = data.routes.map(
      (route: {
        summary: string
        legs: Array<{
          start_address: string
          end_address: string
          start_location: { lat: number; lng: number }
          end_location: { lat: number; lng: number }
          distance: { text: string; value: number }
          duration: { text: string; value: number }
          steps: Array<{
            html_instructions: string
            distance: { text: string; value: number }
            duration: { text: string; value: number }
            start_location: { lat: number; lng: number }
            end_location: { lat: number; lng: number }
            travel_mode: string
            maneuver?: string
          }>
        }>
        overview_polyline: { points: string }
        warnings: string[]
        waypoint_order: number[]
      }) => ({
        summary: route.summary,
        legs: route.legs.map((leg) => ({
          startAddress: leg.start_address,
          endAddress: leg.end_address,
          startLocation: {
            lat: leg.start_location.lat,
            lng: leg.start_location.lng,
          },
          endLocation: {
            lat: leg.end_location.lat,
            lng: leg.end_location.lng,
          },
          distanceText: leg.distance.text,
          distanceMeters: leg.distance.value,
          durationText: leg.duration.text,
          durationSeconds: leg.duration.value,
          steps: leg.steps.map((step) => ({
            instruction: step.html_instructions.replace(/<[^>]*>/g, ''),
            distanceText: step.distance.text,
            distanceMeters: step.distance.value,
            durationText: step.duration.text,
            durationSeconds: step.duration.value,
            startLocation: {
              lat: step.start_location.lat,
              lng: step.start_location.lng,
            },
            endLocation: {
              lat: step.end_location.lat,
              lng: step.end_location.lng,
            },
            travelMode: step.travel_mode,
            maneuver: step.maneuver ?? null,
          })),
        })),
        overviewPolyline: route.overview_polyline.points,
        warnings: route.warnings ?? [],
        waypointOrder: route.waypoint_order ?? [],
      })
    )

    const primaryRoute = routes[0]
    const primaryLeg = primaryRoute?.legs[0]

    return {
      success: true,
      output: {
        routes,
        distanceText: primaryLeg?.distanceText ?? '',
        distanceMeters: primaryLeg?.distanceMeters ?? 0,
        durationText: primaryLeg?.durationText ?? '',
        durationSeconds: primaryLeg?.durationSeconds ?? 0,
        startAddress: primaryLeg?.startAddress ?? '',
        endAddress: primaryLeg?.endAddress ?? '',
        steps: primaryLeg?.steps ?? [],
        polyline: primaryRoute?.overviewPolyline ?? '',
      },
    }
  },

  outputs: {
    routes: {
      type: 'array',
      description: 'All available routes',
      items: {
        type: 'object',
        properties: {
          summary: { type: 'string', description: 'Route summary (main road names)' },
          legs: { type: 'array', description: 'Route legs (segments between waypoints)' },
          overviewPolyline: {
            type: 'string',
            description: 'Encoded polyline for the entire route',
          },
          warnings: { type: 'array', description: 'Route warnings' },
          waypointOrder: { type: 'array', description: 'Optimized waypoint order (if requested)' },
        },
      },
    },
    distanceText: {
      type: 'string',
      description: 'Total distance as human-readable text (e.g., "5.2 km")',
    },
    distanceMeters: {
      type: 'number',
      description: 'Total distance in meters',
    },
    durationText: {
      type: 'string',
      description: 'Total duration as human-readable text (e.g., "15 mins")',
    },
    durationSeconds: {
      type: 'number',
      description: 'Total duration in seconds',
    },
    startAddress: {
      type: 'string',
      description: 'Resolved starting address',
    },
    endAddress: {
      type: 'string',
      description: 'Resolved ending address',
    },
    steps: {
      type: 'array',
      description: 'Turn-by-turn navigation instructions',
      items: {
        type: 'object',
        properties: {
          instruction: { type: 'string', description: 'Navigation instruction (HTML stripped)' },
          distanceText: { type: 'string', description: 'Step distance as text' },
          distanceMeters: { type: 'number', description: 'Step distance in meters' },
          durationText: { type: 'string', description: 'Step duration as text' },
          durationSeconds: { type: 'number', description: 'Step duration in seconds' },
          startLocation: { type: 'object', description: 'Step start coordinates' },
          endLocation: { type: 'object', description: 'Step end coordinates' },
          travelMode: { type: 'string', description: 'Travel mode for this step' },
          maneuver: {
            type: 'string',
            description: 'Maneuver type (turn-left, etc.)',
            optional: true,
          },
        },
      },
    },
    polyline: {
      type: 'string',
      description: 'Encoded polyline for the primary route',
    },
  },
}
