import type { ToolConfig } from '../types'
import type { AirtableUpdateMultipleParams, AirtableUpdateMultipleResponse } from './types'

// import { logger } from '@/utils/logger' // Removed logger due to import issues

export const airtableUpdateMultipleRecordsTool: ToolConfig<
  AirtableUpdateMultipleParams,
  AirtableUpdateMultipleResponse
> = {
  id: 'airtable_update_multiple_records',
  name: 'Airtable Update Multiple Records',
  description: 'Update multiple existing records in an Airtable table',
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
    records: {
      type: 'json',
      required: true,
      visibility: 'user-or-llm',
      description: 'Array of records to update, each with an `id` and a `fields` object',
      // Example: [{ id: "rec123", fields: { "Status": "Done" } }, { id: "rec456", fields: { "Priority": "High" } }]
    },
    // TODO: Add typecast, performUpsert parameters
  },

  request: {
    // The API endpoint uses PATCH for multiple record updates as well
    url: (params) => `https://api.airtable.com/v0/${params.baseId}/${params.tableId}`,
    method: 'PATCH',
    headers: (params) => ({
      Authorization: `Bearer ${params.accessToken}`,
      'Content-Type': 'application/json',
    }),
    // Body should contain { records: [...] } and optionally { typecast: true, performUpsert: {...} }
    body: (params) => ({ records: params.records }),
  },

  transformResponse: async (response) => {
    const data = await response.json()
    if (!response.ok) {
      // logger.error('Airtable API error:', data)
      throw new Error(data.error?.message || 'Failed to update Airtable records')
    }
    return {
      success: true,
      output: {
        records: data.records || [], // API returns an array of updated records
        metadata: {
          recordCount: (data.records || []).length,
          updatedRecordIds: (data.records || []).map((r: any) => r.id),
        },
      },
    }
  },

  transformError: (error: any) => {
    // logger.error('Airtable tool error:', error)
    return `Failed to update multiple Airtable records: ${error.message || 'Unknown error'}`
  },
}
