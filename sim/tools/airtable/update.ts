import { ToolConfig } from '../types'
import { AirtableUpdateParams, AirtableUpdateResponse } from './types'

export const updateTool: ToolConfig<AirtableUpdateParams, AirtableUpdateResponse> = {
  id: 'airtable_update',
  name: 'Airtable Update Records',
  description: 'Update existing records in an Airtable table',
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
    recordId: {
      type: 'string',
      required: true,
      description: 'ID of the record to update',
    },
    fields: {
      type: 'json',
      required: true,
      description: 'Fields to update',
    },
  },

  request: {
    url: (params) =>
      `https://api.airtable.com/v0/${params.baseId}/${params.tableId}/${params.recordId}`,
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
        records: [data],
        metadata: {
          recordCount: 1,
          updatedFields: Object.keys(data.fields),
        },
      },
    }
  },

  transformError: (error) => {
    return `Failed to update Airtable record: ${error.message}`
  },
}
