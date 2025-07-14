import type { ToolConfig } from '../types'
import type { AirtableListParams, AirtableListResponse } from './types'

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
      visibility: 'user-only',
      description: 'ID of the Airtable base',
    },
    tableId: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'ID of the table',
    },
    maxRecords: {
      type: 'number',
      required: false,
      visibility: 'user-only',
      description: 'Maximum number of records to return',
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
      const url = `https://api.airtable.com/v0/${params.baseId}/${params.tableId}`
      const queryParams = new URLSearchParams()
      if (params.maxRecords) queryParams.append('maxRecords', params.maxRecords.toString())
      if (params.filterFormula) {
        // Airtable formulas often contain characters needing encoding,
        // but standard encodeURIComponent might over-encode.
        // Simple replacement for single quotes is often sufficient.
        // More complex formulas might need careful encoding.
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
    if (!response.ok) {
      throw new Error(data.error?.message || 'Failed to fetch Airtable records')
    }
    return {
      success: true,
      output: {
        records: data.records || [],
        metadata: {
          offset: data.offset,
          totalRecords: (data.records || []).length,
        },
      },
    }
  },

  transformError: (error: any) => {
    return `Failed to list Airtable records: ${error.message || 'Unknown error'}`
  },
}
