import type { IroncladGetRecordParams, IroncladGetRecordResponse } from '@/tools/ironclad/types'
import type { ToolConfig } from '@/tools/types'

export const getRecordTool: ToolConfig<IroncladGetRecordParams, IroncladGetRecordResponse> = {
  id: 'ironclad_get_record',
  name: 'Ironclad Get Record',
  description: 'Retrieve details of a specific record by its ID.',
  version: '1.0.0',

  oauth: {
    required: true,
    provider: 'ironclad',
  },

  params: {
    accessToken: {
      type: 'string',
      required: true,
      visibility: 'hidden',
      description: 'OAuth access token',
    },
    recordId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'The unique identifier of the record',
    },
  },

  request: {
    url: (params) => `https://na1.ironcladapp.com/public/api/v1/records/${params.recordId.trim()}`,
    method: 'GET',
    headers: (params) => ({
      Authorization: `Bearer ${params.accessToken}`,
      Accept: 'application/json',
    }),
  },

  transformResponse: async (response: Response) => {
    const data = await response.json()

    if (!response.ok) {
      throw new Error(data.message || data.error || 'Failed to get record')
    }

    return {
      success: true,
      output: {
        id: data.id ?? '',
        name: data.name ?? null,
        type: data.type ?? null,
        properties: data.properties ?? null,
        createdAt: data.createdAt ?? null,
        updatedAt: data.updatedAt ?? null,
      },
    }
  },

  outputs: {
    id: { type: 'string', description: 'The record ID' },
    name: { type: 'string', description: 'The record name' },
    type: { type: 'string', description: 'The record type' },
    properties: { type: 'json', description: 'The record properties' },
    createdAt: { type: 'string', description: 'When the record was created' },
    updatedAt: { type: 'string', description: 'When the record was last updated' },
  },
}
