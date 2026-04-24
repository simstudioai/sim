import type { ToolConfig, ToolResponse } from '@/tools/types'

interface AshbyListLocationsParams {
  apiKey: string
}

interface AshbyLocation {
  id: string
  name: string
  externalName: string | null
  isArchived: boolean
  isRemote: boolean
  workplaceType: string | null
  parentLocationId: string | null
  type: string | null
  address: {
    addressCountry: string | null
    addressRegion: string | null
    addressLocality: string | null
    postalCode: string | null
    streetAddress: string | null
  } | null
}

interface AshbyListLocationsResponse extends ToolResponse {
  output: {
    locations: AshbyLocation[]
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
              address?: { postalAddress?: Record<string, unknown> }
            }
          ) => {
            const pa = l.address?.postalAddress
            return {
              id: (l.id as string) ?? '',
              name: (l.name as string) ?? '',
              externalName: (l.externalName as string) ?? null,
              isArchived: (l.isArchived as boolean) ?? false,
              isRemote: (l.isRemote as boolean) ?? false,
              workplaceType: (l.workplaceType as string) ?? null,
              parentLocationId: (l.parentLocationId as string) ?? null,
              type: (l.type as string) ?? null,
              address: pa
                ? {
                    addressCountry: (pa.addressCountry as string) ?? null,
                    addressRegion: (pa.addressRegion as string) ?? null,
                    addressLocality: (pa.addressLocality as string) ?? null,
                    postalCode: (pa.postalCode as string) ?? null,
                    streetAddress: (pa.streetAddress as string) ?? null,
                  }
                : null,
            }
          }
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
          externalName: {
            type: 'string',
            description: 'Candidate-facing name used on job boards',
            optional: true,
          },
          isArchived: { type: 'boolean', description: 'Whether the location is archived' },
          isRemote: {
            type: 'boolean',
            description: 'Whether the location is remote (use workplaceType instead)',
          },
          workplaceType: {
            type: 'string',
            description: 'Workplace type (OnSite, Hybrid, Remote)',
            optional: true,
          },
          parentLocationId: {
            type: 'string',
            description: 'Parent location UUID',
            optional: true,
          },
          type: {
            type: 'string',
            description: 'Location component type (Location, LocationHierarchy)',
            optional: true,
          },
          address: {
            type: 'object',
            description: 'Location postal address',
            optional: true,
            properties: {
              addressCountry: { type: 'string', description: 'Country', optional: true },
              addressRegion: {
                type: 'string',
                description: 'State or region',
                optional: true,
              },
              addressLocality: {
                type: 'string',
                description: 'City or locality',
                optional: true,
              },
              postalCode: { type: 'string', description: 'Postal code', optional: true },
              streetAddress: { type: 'string', description: 'Street address', optional: true },
            },
          },
        },
      },
    },
  },
}
