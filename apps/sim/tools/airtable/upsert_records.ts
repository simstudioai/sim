import type { AirtableUpsertParams, AirtableUpsertResponse } from '@/tools/airtable/types'
import type { ToolConfig } from '@/tools/types'

export const airtableUpsertRecordsTool: ToolConfig<AirtableUpsertParams, AirtableUpsertResponse> = {
  id: 'airtable_upsert_records',
  name: 'Airtable Upsert Records',
  description:
    'Update existing records or create new ones in an Airtable table, matching on the specified merge fields',
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
      description: 'Array of records to upsert, each with a `fields` object',
    },
    fieldsToMergeOn: {
      type: 'json',
      required: true,
      visibility: 'user-or-llm',
      description:
        'Array of field names used to match existing records (max 3). A record is updated when all merge fields match, otherwise it is created. Example: ["Name"]',
    },
    typecast: {
      type: 'boolean',
      required: false,
      visibility: 'user-or-llm',
      description: 'When true, Airtable automatically converts string values to the field type',
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
    body: (params) => {
      const mergeFields = (params.fieldsToMergeOn ?? [])
        .map((f) => (f == null ? '' : String(f).trim()))
        .filter(Boolean)
      if (mergeFields.length === 0) {
        throw new Error('At least one field to merge on is required for upsert')
      }
      if (mergeFields.length > 3) {
        throw new Error(
          `Airtable upsert accepts at most 3 fields to merge on (received ${mergeFields.length}).`
        )
      }
      const records = params.records ?? []
      if (records.length > 10) {
        throw new Error(
          `Airtable upserts at most 10 records per request (received ${records.length}). Split the upsert into batches of 10 or fewer.`
        )
      }
      const body: Record<string, unknown> = {
        performUpsert: { fieldsToMergeOn: mergeFields },
        records,
      }
      if (params.typecast != null) body.typecast = params.typecast
      return body
    },
  },

  transformResponse: async (response) => {
    const data = await response.json()
    const records = data.records ?? []
    const createdRecords = data.createdRecords ?? []
    const updatedRecords = data.updatedRecords ?? []
    return {
      success: true,
      output: {
        records,
        createdRecords,
        updatedRecords,
        metadata: {
          recordCount: records.length,
          createdCount: createdRecords.length,
          updatedCount: updatedRecords.length,
        },
      },
    }
  },

  outputs: {
    records: {
      type: 'array',
      description: 'Array of upserted Airtable records',
      items: {
        type: 'object',
        properties: {
          id: { type: 'string', description: 'Record ID' },
          createdTime: { type: 'string', description: 'Record creation timestamp' },
          fields: { type: 'json', description: 'Record field values' },
        },
      },
    },
    createdRecords: {
      type: 'array',
      description: 'IDs of records that were created',
      items: { type: 'string', description: 'Created record ID' },
    },
    updatedRecords: {
      type: 'array',
      description: 'IDs of records that were updated',
      items: { type: 'string', description: 'Updated record ID' },
    },
    metadata: {
      type: 'json',
      description: 'Operation metadata',
      properties: {
        recordCount: { type: 'number', description: 'Total number of records returned' },
        createdCount: { type: 'number', description: 'Number of records created' },
        updatedCount: { type: 'number', description: 'Number of records updated' },
      },
    },
  },
}
