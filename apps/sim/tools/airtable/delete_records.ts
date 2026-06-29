import type { AirtableDeleteParams, AirtableDeleteResponse } from '@/tools/airtable/types'
import type { ToolConfig } from '@/tools/types'

export const airtableDeleteRecordsTool: ToolConfig<AirtableDeleteParams, AirtableDeleteResponse> = {
  id: 'airtable_delete_records',
  name: 'Airtable Delete Records',
  description: 'Delete one or more records from an Airtable table by ID',
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
    recordIds: {
      type: 'json',
      required: true,
      visibility: 'user-or-llm',
      description:
        'Array of record IDs to delete (each starts with "rec", e.g., ["recXXXXXXXXXXXXXX"]). Pass a single-element array to delete one record.',
    },
  },

  request: {
    url: (params) => {
      const base = `https://api.airtable.com/v0/${params.baseId?.trim()}/${params.tableId?.trim()}`
      const ids = (params.recordIds ?? [])
        .map((id) => (id == null ? '' : String(id).trim()))
        .filter(Boolean)
      if (ids.length === 0) {
        throw new Error('At least one record ID is required to delete')
      }
      if (ids.length > 10) {
        throw new Error(
          `Airtable deletes at most 10 records per request (received ${ids.length}). Split the delete into batches of 10 or fewer.`
        )
      }
      const queryParams = new URLSearchParams()
      for (const id of ids) {
        queryParams.append('records[]', id as string)
      }
      return `${base}?${queryParams.toString()}`
    },
    method: 'DELETE',
    headers: (params) => ({
      Authorization: `Bearer ${params.accessToken}`,
      'Content-Type': 'application/json',
    }),
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
          deletedRecordIds: records.map((r: { id: string }) => r.id),
        },
      },
    }
  },

  outputs: {
    records: {
      type: 'array',
      description: 'Array of deleted Airtable records',
      items: {
        type: 'object',
        properties: {
          id: { type: 'string', description: 'Record ID' },
          deleted: { type: 'boolean', description: 'Whether the record was deleted' },
        },
      },
    },
    metadata: {
      type: 'json',
      description: 'Operation metadata',
      properties: {
        recordCount: { type: 'number', description: 'Number of records deleted' },
        deletedRecordIds: { type: 'array', description: 'List of deleted record IDs' },
      },
    },
  },
}
