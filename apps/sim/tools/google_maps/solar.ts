import type { GoogleMapsSolarParams, GoogleMapsSolarResponse } from '@/tools/google_maps/types'
import type { ToolConfig } from '@/tools/types'

export const googleMapsSolarTool: ToolConfig<GoogleMapsSolarParams, GoogleMapsSolarResponse> = {
  id: 'google_maps_solar',
  name: 'Google Maps Solar',
  description: 'Get solar potential and panel insights for the building nearest a location',
  version: '1.0.0',

  params: {
    apiKey: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'Google Maps API key with Solar API enabled',
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
    requiredQuality: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Minimum imagery quality to accept (HIGH, MEDIUM, or BASE)',
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
      const url = new URL('https://solar.googleapis.com/v1/buildingInsights:findClosest')
      url.searchParams.set('location.latitude', params.lat.toString())
      url.searchParams.set('location.longitude', params.lng.toString())
      if (params.requiredQuality) {
        url.searchParams.set('requiredQuality', params.requiredQuality)
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
      throw new Error(`Solar lookup failed: ${data.error?.message || response.statusText}`)
    }

    const potential = data.solarPotential
    const solarPotential = potential
      ? {
          maxArrayPanelsCount: potential.maxArrayPanelsCount ?? 0,
          maxArrayAreaMeters2: potential.maxArrayAreaMeters2 ?? 0,
          maxSunshineHoursPerYear: potential.maxSunshineHoursPerYear ?? 0,
          carbonOffsetFactorKgPerMwh: potential.carbonOffsetFactorKgPerMwh ?? 0,
          panelCapacityWatts: potential.panelCapacityWatts ?? 0,
          panelHeightMeters: potential.panelHeightMeters ?? 0,
          panelWidthMeters: potential.panelWidthMeters ?? 0,
          panelLifetimeYears: potential.panelLifetimeYears ?? 0,
          solarPanelConfigs: (potential.solarPanelConfigs || []).map(
            (config: { panelsCount?: number; yearlyEnergyDcKwh?: number }) => ({
              panelsCount: config.panelsCount ?? 0,
              yearlyEnergyDcKwh: config.yearlyEnergyDcKwh ?? 0,
            })
          ),
        }
      : null

    return {
      success: true,
      output: {
        name: data.name || '',
        center: {
          lat: data.center?.latitude ?? 0,
          lng: data.center?.longitude ?? 0,
        },
        imageryDate: data.imageryDate
          ? {
              year: data.imageryDate.year ?? 0,
              month: data.imageryDate.month ?? 0,
              day: data.imageryDate.day ?? 0,
            }
          : null,
        imageryQuality: data.imageryQuality || '',
        regionCode: data.regionCode || '',
        postalCode: data.postalCode || '',
        administrativeArea: data.administrativeArea || '',
        solarPotential,
      },
    }
  },

  outputs: {
    name: {
      type: 'string',
      description: 'Resource name of the building (e.g., "buildings/ChIJ...")',
    },
    center: {
      type: 'object',
      description: 'Center coordinate of the building',
      properties: {
        lat: { type: 'number', description: 'Latitude' },
        lng: { type: 'number', description: 'Longitude' },
      },
    },
    imageryDate: {
      type: 'object',
      description: 'Date the underlying imagery was captured',
    },
    imageryQuality: {
      type: 'string',
      description: 'Quality of the imagery used (HIGH, MEDIUM, BASE)',
    },
    regionCode: {
      type: 'string',
      description: 'Region code (ISO 3166-1 alpha-2) for the building',
    },
    postalCode: {
      type: 'string',
      description: 'Postal code of the building',
    },
    administrativeArea: {
      type: 'string',
      description: 'Administrative area (e.g., state or province)',
    },
    solarPotential: {
      type: 'object',
      description:
        'Solar potential: max panel count/area, sunshine hours, carbon offset, panel specs, and configs',
    },
  },
}
