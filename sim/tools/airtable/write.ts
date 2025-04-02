import { ToolConfig } from '../types'
import { AirtableWriteParams, AirtableWriteResponse } from './types'

export const writeTool: ToolConfig<AirtableWriteParams, AirtableWriteResponse> = {
  id: 'airtable_write',
  name: 'Airtable Write Records',
  description: 'Write new records to an Airtable table',
  version: '1.0.0',

  oauth: {
    required: true,
    provider: 'airtable',
  },

  params: {
    accessToken: {
      type: 'string',
      required: true,
      description: 'OAuth access token',
    },
    baseId: {
      type: 'string',
      required: true,
      description: 'ID of the Airtable base',
    },
    tableId: {
      type: 'string',
      required: true,
      description: 'ID or name of the table',
    },
    records: {
      type: 'json',
      required: true,
      description: 'Array of records to create',
    },
  },

  request: {
    url: (params) => `https://api.airtable.com/v0/${params.baseId}/${params.tableId}`,
    method: 'POST',
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
        records: data.records,
        metadata: {
          recordCount: data.records.length,
        },
      },
    }
  },

  transformError: (error) => {
    return `Failed to write Airtable records: ${error.message}`
  },
}
