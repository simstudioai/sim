import type { ToolConfig } from '../types'
import type { AirtableGetParams, AirtableGetResponse } from './types'

// import { logger } from '@/utils/logger' // Removed logger due to import issues

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
      description: 'ID of the record to retrieve',
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
    if (!response.ok) {
      // logger.error('Airtable API error:', data)
      throw new Error(data.error?.message || 'Failed to get Airtable record')
    }
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

  transformError: (error: any) => {
    // logger.error('Airtable tool error:', error)
    return `Failed to get Airtable record: ${error.message || 'Unknown error'}`
  },
}
