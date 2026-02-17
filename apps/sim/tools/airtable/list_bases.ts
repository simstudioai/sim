import type { ToolConfig, ToolResponse } from '@/tools/types'

export interface AirtableListBasesParams {
  accessToken: string
}

export interface AirtableListBasesResponse extends ToolResponse {
  output: {
    bases: Array<{
      id: string
      name: string
      permissionLevel: string
    }>
    metadata: {
      totalBases: number
    }
  }
}

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
    },

    request: {
      url: 'https://api.airtable.com/v0/meta/bases',
      method: 'GET',
      headers: (params) => ({
        Authorization: `Bearer ${params.accessToken}`,
      }),
    },

    transformResponse: async (response) => {
      const data = await response.json()
      const bases = (data.bases || []).map((base: Record<string, unknown>) => ({
        id: base.id,
        name: base.name,
        permissionLevel: base.permissionLevel,
      }))
      return {
        success: true,
        output: {
          bases,
          metadata: {
            totalBases: bases.length,
          },
        },
      }
    },

    outputs: {
      bases: {
        type: 'json',
        description: 'Array of Airtable bases with id, name, and permissionLevel',
        items: {
          type: 'object',
          properties: {
            id: { type: 'string' },
            name: { type: 'string' },
            permissionLevel: { type: 'string' },
          },
        },
      },
      metadata: {
        type: 'json',
        description: 'Operation metadata including total bases count',
      },
    },
  }
