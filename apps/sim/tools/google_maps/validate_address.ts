import type {
  GoogleMapsValidateAddressParams,
  GoogleMapsValidateAddressResponse,
} from '@/tools/google_maps/types'
import type { ToolConfig } from '@/tools/types'

export const googleMapsValidateAddressTool: ToolConfig<
  GoogleMapsValidateAddressParams,
  GoogleMapsValidateAddressResponse
> = {
  id: 'google_maps_validate_address',
  name: 'Google Maps Validate Address',
  description: 'Validate and standardize a postal address',
  version: '1.0.0',

  params: {
    apiKey: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'Google Maps API key with Address Validation API enabled',
    },
    address: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'The address to validate (as a single string)',
    },
    regionCode: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'ISO 3166-1 alpha-2 country code (e.g., "US", "CA")',
    },
    locality: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'City or locality name',
    },
    enableUspsCass: {
      type: 'boolean',
      required: false,
      visibility: 'user-or-llm',
      description: 'Enable USPS CASS validation for US addresses',
    },
  },

  request: {
    url: (params) => {
      return `https://addressvalidation.googleapis.com/v1:validateAddress?key=${params.apiKey.trim()}`
    },
    method: 'POST',
    headers: () => ({
      'Content-Type': 'application/json',
    }),
    body: (params) => {
      const body: {
        address: { addressLines: string[]; regionCode?: string; locality?: string }
        enableUspsCass?: boolean
      } = {
        address: {
          addressLines: [params.address.trim()],
        },
      }

      if (params.regionCode) {
        body.address.regionCode = params.regionCode.trim()
      }

      if (params.locality) {
        body.address.locality = params.locality.trim()
      }

      if (params.enableUspsCass !== undefined) {
        body.enableUspsCass = params.enableUspsCass
      }

      return body
    },
  },

  transformResponse: async (response: Response) => {
    const data = await response.json()

    if (data.error) {
      throw new Error(`Address Validation failed: ${data.error.message || 'Unknown error'}`)
    }

    const result = data.result
    const verdict = result?.verdict || {}
    const address = result?.address || {}
    const geocode = result?.geocode || {}

    const addressComponents = (address.addressComponents || []).map(
      (comp: {
        componentName: { text: string; languageCode?: string }
        componentType: string
        confirmationLevel: string
      }) => ({
        longName: comp.componentName?.text || '',
        shortName: comp.componentName?.text || '',
        types: [comp.componentType],
      })
    )

    return {
      success: true,
      output: {
        formattedAddress: address.formattedAddress || '',
        lat: geocode.location?.latitude || 0,
        lng: geocode.location?.longitude || 0,
        placeId: geocode.placeId || '',
        addressComplete: verdict.addressComplete || false,
        hasUnconfirmedComponents: verdict.hasUnconfirmedComponents || false,
        hasInferredComponents: verdict.hasInferredComponents || false,
        hasReplacedComponents: verdict.hasReplacedComponents || false,
        validationGranularity: verdict.validationGranularity || '',
        geocodeGranularity: verdict.geocodeGranularity || '',
        addressComponents,
        missingComponentTypes: address.missingComponentTypes || [],
        unconfirmedComponentTypes: address.unconfirmedComponentTypes || [],
        unresolvedTokens: address.unresolvedTokens || [],
      },
    }
  },

  outputs: {
    formattedAddress: {
      type: 'string',
      description: 'The standardized formatted address',
    },
    lat: {
      type: 'number',
      description: 'Latitude coordinate',
    },
    lng: {
      type: 'number',
      description: 'Longitude coordinate',
    },
    placeId: {
      type: 'string',
      description: 'Google Place ID for this address',
    },
    addressComplete: {
      type: 'boolean',
      description: 'Whether the address is complete and deliverable',
    },
    hasUnconfirmedComponents: {
      type: 'boolean',
      description: 'Whether some address components could not be confirmed',
    },
    hasInferredComponents: {
      type: 'boolean',
      description: 'Whether some components were inferred (not in input)',
    },
    hasReplacedComponents: {
      type: 'boolean',
      description: 'Whether some components were replaced with canonical values',
    },
    validationGranularity: {
      type: 'string',
      description: 'Granularity of validation (PREMISE, SUB_PREMISE, ROUTE, etc.)',
    },
    geocodeGranularity: {
      type: 'string',
      description: 'Granularity of the geocode result',
    },
    addressComponents: {
      type: 'array',
      description: 'Detailed address components',
      items: {
        type: 'object',
        properties: {
          longName: { type: 'string', description: 'Full name of the component' },
          shortName: { type: 'string', description: 'Abbreviated name' },
          types: { type: 'array', description: 'Component types' },
        },
      },
    },
    missingComponentTypes: {
      type: 'array',
      description: 'Types of address components that are missing',
    },
    unconfirmedComponentTypes: {
      type: 'array',
      description: 'Types of components that could not be confirmed',
    },
    unresolvedTokens: {
      type: 'array',
      description: 'Input tokens that could not be resolved',
    },
  },
}
