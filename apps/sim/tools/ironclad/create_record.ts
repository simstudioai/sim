import type {
  IroncladCreateRecordParams,
  IroncladCreateRecordResponse,
} from '@/tools/ironclad/types'
import type { ToolConfig } from '@/tools/types'

export const createRecordTool: ToolConfig<
  IroncladCreateRecordParams,
  IroncladCreateRecordResponse
> = {
  id: 'ironclad_create_record',
  name: 'Ironclad Create Record',
  description: 'Create a new record in Ironclad with a specified type, name, and properties.',
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
    recordType: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'The record type (e.g., "contract", "Statement of Work")',
    },
    name: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'A human-readable name for the record',
    },
    properties: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        'JSON object of properties. Each property has a "type" (string/number/email/date/monetary_amount) and "value".',
    },
    links: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'JSON array of linked record objects, each with a "recordId" field',
    },
  },

  request: {
    url: () => 'https://na1.ironcladapp.com/public/api/v1/records',
    method: 'POST',
    headers: (params) => ({
      Authorization: `Bearer ${params.accessToken}`,
      'Content-Type': 'application/json',
      Accept: 'application/json',
    }),
    body: (params) => {
      const body: Record<string, unknown> = {
        type: params.recordType,
        name: params.name,
      }
      if (params.properties) {
        try {
          body.properties = JSON.parse(params.properties)
        } catch {
          throw new Error('Invalid JSON in properties field')
        }
      }
      if (params.links) {
        try {
          body.links = JSON.parse(params.links)
        } catch {
          throw new Error('Invalid JSON in links field')
        }
      }
      return body
    },
  },

  transformResponse: async (response: Response) => {
    const data = await response.json()

    if (!response.ok) {
      throw new Error(data.message || data.error || 'Failed to create record')
    }

    return {
      success: true,
      output: {
        id: data.id ?? '',
        name: data.name ?? '',
        type: data.type ?? null,
      },
    }
  },

  outputs: {
    id: { type: 'string', description: 'The ID of the created record' },
    name: { type: 'string', description: 'The name of the record' },
    type: { type: 'string', description: 'The type of the record' },
  },
}
