import type {
  GoogleMapsGeolocateParams,
  GoogleMapsGeolocateResponse,
} from '@/tools/google_maps/types'
import type { ToolConfig } from '@/tools/types'

export const googleMapsGeolocateTool: ToolConfig<
  GoogleMapsGeolocateParams,
  GoogleMapsGeolocateResponse
> = {
  id: 'google_maps_geolocate',
  name: 'Google Maps Geolocate',
  description: 'Geolocate a device using WiFi access points, cell towers, or IP address',
  version: '1.0.0',

  params: {
    apiKey: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'Google Maps API key with Geolocation API enabled',
    },
    homeMobileCountryCode: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Home mobile country code (MCC)',
    },
    homeMobileNetworkCode: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Home mobile network code (MNC)',
    },
    radioType: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Radio type: lte, gsm, cdma, wcdma, or nr',
    },
    carrier: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Carrier name',
    },
    considerIp: {
      type: 'boolean',
      required: false,
      visibility: 'user-or-llm',
      description: 'Whether to use IP address for geolocation (default: true)',
    },
    cellTowers: {
      type: 'array',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Array of cell tower objects with cellId, locationAreaCode, mobileCountryCode, mobileNetworkCode',
    },
    wifiAccessPoints: {
      type: 'array',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Array of WiFi access point objects with macAddress (required), signalStrength, etc.',
    },
  },

  request: {
    url: (params) => {
      return `https://www.googleapis.com/geolocation/v1/geolocate?key=${params.apiKey.trim()}`
    },
    method: 'POST',
    headers: () => ({
      'Content-Type': 'application/json',
    }),
    body: (params) => {
      const body: {
        homeMobileCountryCode?: number
        homeMobileNetworkCode?: number
        radioType?: string
        carrier?: string
        considerIp?: boolean
        cellTowers?: Array<{
          cellId: number
          locationAreaCode: number
          mobileCountryCode: number
          mobileNetworkCode: number
          age?: number
          signalStrength?: number
          timingAdvance?: number
        }>
        wifiAccessPoints?: Array<{
          macAddress: string
          signalStrength?: number
          age?: number
          channel?: number
          signalToNoiseRatio?: number
        }>
      } = {}

      if (params.homeMobileCountryCode !== undefined) {
        body.homeMobileCountryCode = params.homeMobileCountryCode
      }

      if (params.homeMobileNetworkCode !== undefined) {
        body.homeMobileNetworkCode = params.homeMobileNetworkCode
      }

      if (params.radioType) {
        body.radioType = params.radioType
      }

      if (params.carrier) {
        body.carrier = params.carrier
      }

      if (params.considerIp !== undefined) {
        body.considerIp = params.considerIp
      }

      if (params.cellTowers && params.cellTowers.length > 0) {
        body.cellTowers = params.cellTowers
      }

      if (params.wifiAccessPoints && params.wifiAccessPoints.length > 0) {
        body.wifiAccessPoints = params.wifiAccessPoints
      }

      return body
    },
  },

  transformResponse: async (response: Response) => {
    const data = await response.json()

    if (data.error) {
      throw new Error(`Geolocation failed: ${data.error.message || 'Unknown error'}`)
    }

    return {
      success: true,
      output: {
        lat: data.location?.lat || 0,
        lng: data.location?.lng || 0,
        accuracy: data.accuracy || 0,
      },
    }
  },

  outputs: {
    lat: {
      type: 'number',
      description: 'Latitude coordinate',
    },
    lng: {
      type: 'number',
      description: 'Longitude coordinate',
    },
    accuracy: {
      type: 'number',
      description: 'Accuracy radius in meters',
    },
  },
}
