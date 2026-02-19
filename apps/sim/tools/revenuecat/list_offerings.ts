import type { ListOfferingsParams, ListOfferingsResponse } from '@/tools/revenuecat/types'
import {
  OFFERING_OUTPUT_PROPERTIES,
  OFFERINGS_METADATA_OUTPUT_PROPERTIES,
} from '@/tools/revenuecat/types'
import type { ToolConfig } from '@/tools/types'

export const revenuecatListOfferingsTool: ToolConfig<ListOfferingsParams, ListOfferingsResponse> = {
  id: 'revenuecat_list_offerings',
  name: 'RevenueCat List Offerings',
  description: 'List all offerings configured for the project',
  version: '1.0.0',

  params: {
    apiKey: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'RevenueCat API key',
    },
    appUserId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'An app user ID to retrieve offerings for',
    },
    platform: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Platform to filter offerings (ios, android, stripe, etc.)',
    },
  },

  request: {
    url: (params) =>
      `https://api.revenuecat.com/v1/subscribers/${encodeURIComponent(params.appUserId)}/offerings`,
    method: 'GET',
    headers: (params) => {
      const headers: Record<string, string> = {
        Authorization: `Bearer ${params.apiKey}`,
        'Content-Type': 'application/json',
      }
      if (params.platform) {
        headers['X-Platform'] = params.platform
      }
      return headers
    },
  },

  transformResponse: async (response) => {
    const data = await response.json()
    const offerings = data.offerings ?? []
    const currentOfferingId = data.current_offering_id ?? null

    return {
      success: true,
      output: {
        current_offering_id: currentOfferingId,
        offerings: offerings.map((offering: Record<string, unknown>) => ({
          identifier: (offering.identifier as string) ?? '',
          description: (offering.description as string) ?? null,
          packages: ((offering.packages as Array<Record<string, unknown>>) ?? []).map(
            (pkg: Record<string, unknown>) => ({
              identifier: (pkg.identifier as string) ?? '',
              platform_product_identifier: (pkg.platform_product_identifier as string) ?? null,
            })
          ),
        })),
        metadata: {
          count: offerings.length,
          current_offering_id: currentOfferingId,
        },
      },
    }
  },

  outputs: {
    current_offering_id: {
      type: 'string',
      description: 'The identifier of the current offering',
      optional: true,
    },
    offerings: {
      type: 'array',
      description: 'List of offerings',
      items: {
        type: 'object',
        properties: OFFERING_OUTPUT_PROPERTIES,
      },
    },
    metadata: {
      type: 'object',
      description: 'Offerings metadata',
      properties: OFFERINGS_METADATA_OUTPUT_PROPERTIES,
    },
  },
}
