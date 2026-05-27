import type {
  IroncladUpdateRecordParams,
  IroncladUpdateRecordResponse,
} from '@/tools/ironclad/types'
import type { ToolConfig } from '@/tools/types'

export const updateRecordTool: ToolConfig<
  IroncladUpdateRecordParams,
  IroncladUpdateRecordResponse
> = {
  id: 'ironclad_update_record',
  name: 'Ironclad Update Record',
  description: 'Update metadata fields on an existing record.',
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
      description: 'The unique identifier of the record to update',
    },
    properties: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'JSON object of fields to update (e.g., {"fieldName": "newValue"})',
    },
  },

  request: {
    url: (params) => `https://na1.ironcladapp.com/public/api/v1/records/${params.recordId.trim()}`,
    method: 'PATCH',
    headers: (params) => ({
      Authorization: `Bearer ${params.accessToken}`,
      'Content-Type': 'application/json',
      Accept: 'application/json',
    }),
    body: (params) => {
      try {
        return JSON.parse(params.properties)
      } catch {
        throw new Error('Invalid JSON in properties field')
      }
    },
  },

  transformResponse: async (response: Response) => {
    const data = await response.json()

    if (!response.ok) {
      throw new Error(data.message || data.error || 'Failed to update record')
    }

    return {
      success: true,
      output: {
        id: data.id ?? '',
        name: data.name ?? null,
        type: data.type ?? null,
      },
    }
  },

  outputs: {
    id: { type: 'string', description: 'The record ID' },
    name: { type: 'string', description: 'The record name' },
    type: { type: 'string', description: 'The record type' },
  },
}
