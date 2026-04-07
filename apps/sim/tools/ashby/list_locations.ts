import type { ToolConfig, ToolResponse } from '@/tools/types'

interface AshbyListLocationsParams {
  apiKey: string
}

interface AshbyListLocationsResponse extends ToolResponse {
  output: {
    locations: Array<{
      id: string
      name: string
      isArchived: boolean
      isRemote: boolean
      address: {
        city: string | null
        region: string | null
        country: string | null
      } | null
    }>
  }
}

export const listLocationsTool: ToolConfig<AshbyListLocationsParams, AshbyListLocationsResponse> = {
  id: 'ashby_list_locations',
  name: 'Ashby List Locations',
  description: 'Lists all locations configured in Ashby.',
  version: '1.0.0',

  params: {
    apiKey: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'Ashby API Key',
    },
  },

  request: {
    url: 'https://api.ashbyhq.com/location.list',
    method: 'POST',
    headers: (params) => ({
      'Content-Type': 'application/json',
      Authorization: `Basic ${btoa(`${params.apiKey}:`)}`,
    }),
    body: () => ({}),
  },

  transformResponse: async (response: Response) => {
    const data = await response.json()

    if (!data.success) {
      throw new Error(data.errorInfo?.message || 'Failed to list locations')
    }

    return {
      success: true,
      output: {
        locations: (data.results ?? []).map(
          (
            l: Record<string, unknown> & {
              address?: {
                postalAddress?: {
                  addressLocality?: string
                  addressRegion?: string
                  addressCountry?: string
                }
              }
            }
          ) => ({
            id: l.id ?? null,
            name: l.name ?? null,
            isArchived: l.isArchived ?? false,
            isRemote: l.isRemote ?? false,
            address: l.address?.postalAddress
              ? {
                  city: l.address.postalAddress.addressLocality ?? null,
                  region: l.address.postalAddress.addressRegion ?? null,
                  country: l.address.postalAddress.addressCountry ?? null,
                }
              : null,
          })
        ),
      },
    }
  },

  outputs: {
    locations: {
      type: 'array',
      description: 'List of locations',
      items: {
        type: 'object',
        properties: {
          id: { type: 'string', description: 'Location UUID' },
          name: { type: 'string', description: 'Location name' },
          isArchived: { type: 'boolean', description: 'Whether the location is archived' },
          isRemote: { type: 'boolean', description: 'Whether this is a remote location' },
          address: {
            type: 'object',
            description: 'Location address',
            optional: true,
            properties: {
              city: { type: 'string', description: 'City', optional: true },
              region: { type: 'string', description: 'State or region', optional: true },
              country: { type: 'string', description: 'Country', optional: true },
            },
          },
        },
      },
    },
  },
}
