import type { AirtableGetParams, AirtableGetResponse } from '@/tools/airtable/types'
import type { ToolConfig } from '@/tools/types'

export const airtableGetRecordTool: ToolConfig<AirtableGetParams, AirtableGetResponse> = {
  id: 'airtable_get_record',
  name: 'Airtable Get Record',
  description: 'Retrieve a single record from an Airtable table by its ID',
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
      description: 'Record ID to retrieve (starts with "rec", e.g., "recXXXXXXXXXXXXXX")',
    },
  },

  request: {
    url: (params) =>
      `https://api.airtable.com/v0/${params.baseId}/${params.tableId}/${params.recordId}`,
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
        record: data, // API returns the single record object
        metadata: {
          recordCount: 1,
        },
      },
    }
  },

  outputs: {
    record: {
      type: 'json',
      description: 'Retrieved Airtable record with id, createdTime, and fields',
    },
    metadata: {
      type: 'json',
      description: 'Operation metadata including record count',
    },
  },
}
