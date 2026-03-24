import type { AirtableListBasesParams, AirtableListBasesResponse } from '@/tools/airtable/types'
import type { ToolConfig } from '@/tools/types'

export const airtableListBasesTool: ToolConfig<AirtableListBasesParams, AirtableListBasesResponse> =
  {
    id: 'airtable_list_bases',
    name: 'Airtable List Bases',
    description: 'List all bases the authenticated user has access to',
    version: '1.0.0',

    oauth: {
      required: true,
      provider: 'airtable',
    },

    params: {
      accessToken: {
        type: 'string',
        required: true,
        visibility: 'hidden',
        description: 'OAuth access token',
      },
      offset: {
        type: 'string',
        required: false,
        visibility: 'user-or-llm',
        description: 'Pagination offset for retrieving additional bases',
      },
    },

    request: {
      url: (params) => {
        const url = 'https://api.airtable.com/v0/meta/bases'
        if (params.offset) {
          return `${url}?offset=${encodeURIComponent(params.offset)}`
        }
        return url
      },
      method: 'GET',
      headers: (params) => ({
        Authorization: `Bearer ${params.accessToken}`,
        'Content-Type': 'application/json',
      }),
    },

    transformResponse: async (response) => {
      const data = await response.json()
      return {
        success: true,
        output: {
          bases: (data.bases ?? []).map(
            (base: { id: string; name: string; permissionLevel: string }) => ({
              id: base.id,
              name: base.name,
              permissionLevel: base.permissionLevel,
            })
          ),
          metadata: {
            offset: data.offset ?? null,
            totalBases: (data.bases ?? []).length,
          },
        },
      }
    },

    outputs: {
      bases: {
        type: 'array',
        description: 'Array of Airtable bases with id, name, and permissionLevel',
        items: {
          type: 'object',
          properties: {
            id: { type: 'string', description: 'Base ID (starts with "app")' },
            name: { type: 'string', description: 'Base name' },
            permissionLevel: {
              type: 'string',
              description: 'Permission level (none, read, comment, edit, create)',
            },
          },
        },
      },
      metadata: {
        type: 'json',
        description: 'Pagination and count metadata',
        properties: {
          offset: { type: 'string', description: 'Offset for next page of results' },
          totalBases: { type: 'number', description: 'Number of bases returned' },
        },
      },
    },
  }
