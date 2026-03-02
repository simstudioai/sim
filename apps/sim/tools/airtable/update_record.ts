import type { AirtableUpdateParams, AirtableUpdateResponse } from '@/tools/airtable/types'
import type { ToolConfig } from '@/tools/types'

export const airtableUpdateRecordTool: ToolConfig<AirtableUpdateParams, AirtableUpdateResponse> = {
  id: 'airtable_update_record',
  name: 'Airtable Update Record',
  description: 'Update an existing record in an Airtable table by ID',
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
    recordId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Record ID to update (starts with "rec", e.g., "recXXXXXXXXXXXXXX")',
    },
    fields: {
      type: 'json',
      required: true,
      visibility: 'user-or-llm',
      description: 'An object containing the field names and their new values',
    },
  },

  request: {
    url: (params) =>
      `https://api.airtable.com/v0/${params.baseId?.trim()}/${params.tableId?.trim()}/${params.recordId?.trim()}`,
    method: 'PATCH',
    headers: (params) => ({
      Authorization: `Bearer ${params.accessToken}`,
      'Content-Type': 'application/json',
    }),
    body: (params) => ({ fields: params.fields }),
  },

  transformResponse: async (response) => {
    const data = await response.json()
    return {
      success: true,
      output: {
        record: data,
        metadata: {
          recordCount: 1,
          updatedFields: Object.keys(data.fields ?? {}),
        },
      },
    }
  },

  outputs: {
    record: {
      type: 'json',
      description: 'Updated Airtable record',
      properties: {
        id: { type: 'string', description: 'Record ID' },
        createdTime: { type: 'string', description: 'Record creation timestamp' },
        fields: { type: 'json', description: 'Record field values' },
      },
    },
    metadata: {
      type: 'json',
      description: 'Operation metadata',
      properties: {
        recordCount: { type: 'number', description: 'Number of records updated (always 1)' },
        updatedFields: { type: 'array', description: 'List of field names that were updated' },
      },
    },
  },
}
