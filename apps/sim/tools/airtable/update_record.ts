import type { ToolConfig } from '../types'
import type { AirtableUpdateParams, AirtableUpdateResponse } from './types'

// import { logger } from '@/utils/logger' // Removed logger due to import issues

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
      visibility: 'user-only',
      description: 'ID of the Airtable base',
    },
    tableId: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'ID or name of the table',
    },
    recordId: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'ID of the record to update',
    },
    fields: {
      type: 'json',
      required: true,
      visibility: 'user-or-llm',
      description: 'An object containing the field names and their new values',
      // Example: { "Field 1": "NewValue1", "Status": "Completed" }
    },
    // TODO: Add typecast parameter
  },

  request: {
    // The API endpoint uses PATCH for single record updates
    url: (params) =>
      `https://api.airtable.com/v0/${params.baseId}/${params.tableId}/${params.recordId}`,
    method: 'PATCH',
    headers: (params) => ({
      Authorization: `Bearer ${params.accessToken}`,
      'Content-Type': 'application/json',
    }),
    // Body should contain { fields: {...} } and optionally { typecast: true }
    body: (params) => ({ fields: params.fields }),
  },

  transformResponse: async (response) => {
    const data = await response.json()
    if (!response.ok) {
      // logger.error('Airtable API error:', data)
      throw new Error(data.error?.message || 'Failed to update Airtable record')
    }
    return {
      success: true,
      output: {
        record: data, // API returns the single updated record object
        metadata: {
          recordCount: 1,
          updatedFields: Object.keys(data.fields || {}),
        },
      },
    }
  },

  transformError: (error: any) => {
    // logger.error('Airtable tool error:', error)
    return `Failed to update Airtable record: ${error.message || 'Unknown error'}`
  },
}
