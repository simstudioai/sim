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
      visibility: 'user-only',
      description: 'ID of the Airtable base',
    },
    tableId: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'ID or name of the table',
    },
    records: {
      type: 'json',
      required: true,
      visibility: 'user-or-llm',
      description: 'Array of records to update, each with an `id` and a `fields` object',
    },
  },

  request: {
    // The API endpoint uses PATCH for multiple record updates as well
    url: (params) => `https://api.airtable.com/v0/${params.baseId}/${params.tableId}`,
    method: 'PATCH',
    headers: (params) => ({
      Authorization: `Bearer ${params.accessToken}`,
      'Content-Type': 'application/json',
    }),
    body: (params) => ({ records: params.records }),
  },

  transformResponse: async (response) => {
    const data = await response.json()
    return {
      success: true,
      output: {
        records: data.records || [], // API returns an array of updated records
        metadata: {
          recordCount: (data.records || []).length,
          updatedRecordIds: (data.records || []).map((r: any) => r.id),
        },
      },
    }
  },

  outputs: {
    records: {
      type: 'json',
      description: 'Array of updated Airtable records',
      items: {
        type: 'object',
        properties: {
          id: { type: 'string' },
          createdTime: { type: 'string' },
          fields: { type: 'object' },
        },
      },
    },
    metadata: {
      type: 'json',
      description: 'Operation metadata including record count and updated record IDs',
    },
  },
}
