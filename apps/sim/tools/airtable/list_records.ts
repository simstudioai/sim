import type { AirtableListParams, AirtableListResponse } from '@/tools/airtable/types'
import type { ToolConfig } from '@/tools/types'

export const airtableListRecordsTool: ToolConfig<AirtableListParams, AirtableListResponse> = {
  id: 'airtable_list_records',
  name: 'Airtable List Records',
  description: 'Read records from an Airtable table',
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
    maxRecords: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Maximum number of records to return (default: all records)',
    },
    filterFormula: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Formula to filter records (e.g., "({Field Name} = \'Value\')")',
    },
  },

  request: {
    url: (params) => {
      const url = `https://api.airtable.com/v0/${params.baseId?.trim()}/${params.tableId?.trim()}`
      const queryParams = new URLSearchParams()
      if (params.maxRecords) queryParams.append('maxRecords', Number(params.maxRecords).toString())
      if (params.filterFormula) {
        const encodedFormula = params.filterFormula.replace(/'/g, "'")
        queryParams.append('filterByFormula', encodedFormula)
      }
      const queryString = queryParams.toString()
      const finalUrl = queryString ? `${url}?${queryString}` : url
      return finalUrl
    },
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
        records: data.records ?? [],
        metadata: {
          offset: data.offset ?? null,
          totalRecords: (data.records ?? []).length,
        },
      },
    }
  },

  outputs: {
    records: {
      type: 'array',
      description: 'Array of retrieved Airtable records',
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
      description: 'Operation metadata including pagination offset and total records count',
      properties: {
        offset: { type: 'string', description: 'Pagination offset for next page' },
        totalRecords: { type: 'number', description: 'Number of records returned' },
      },
    },
  },
}
