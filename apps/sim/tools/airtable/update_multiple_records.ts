import type {
  AirtableUpdateMultipleParams,
  AirtableUpdateMultipleResponse,
} from '@/tools/airtable/types'
import type { ToolConfig } from '@/tools/types'

export const airtableUpdateMultipleRecordsTool: ToolConfig<
  AirtableUpdateMultipleParams,
  AirtableUpdateMultipleResponse
> = {
  id: 'airtable_update_multiple_records',
  name: 'Airtable Update Multiple Records',
  description: 'Update multiple existing records in an Airtable table',
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
    baseId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Airtable base ID (starts with "app", e.g., "appXXXXXXXXXXXXXX")',
    },
    tableId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Table ID (starts with "tbl") or table name',
    },
    records: {
      type: 'json',
      required: true,
      visibility: 'user-or-llm',
      description: 'Array of records to update, each with an `id` and a `fields` object',
    },
  },

  request: {
    url: (params) =>
      `https://api.airtable.com/v0/${params.baseId?.trim()}/${params.tableId?.trim()}`,
    method: 'PATCH',
    headers: (params) => ({
      Authorization: `Bearer ${params.accessToken}`,
      'Content-Type': 'application/json',
    }),
    body: (params) => ({ records: params.records }),
  },

  transformResponse: async (response) => {
    const data = await response.json()
    const records = data.records ?? []
    return {
      success: true,
      output: {
        records,
        metadata: {
          recordCount: records.length,
          updatedRecordIds: records.map((r: { id: string }) => r.id),
        },
      },
    }
  },

  outputs: {
    records: {
      type: 'array',
      description: 'Array of updated Airtable records',
      items: {
        type: 'object',
        properties: {
          id: { type: 'string', description: 'Record ID' },
          createdTime: { type: 'string', description: 'Record creation timestamp' },
          fields: { type: 'json', description: 'Record field values' },
        },
      },
    },
    metadata: {
      type: 'json',
      description: 'Operation metadata',
      properties: {
        recordCount: { type: 'number', description: 'Number of records updated' },
        updatedRecordIds: { type: 'array', description: 'List of updated record IDs' },
      },
    },
  },
}
