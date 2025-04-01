import { ToolConfig } from '../types'
import { AirtableReadParams, AirtableReadResponse } from './types'

export const readTool: ToolConfig<AirtableReadParams, AirtableReadResponse> = {
  id: 'airtable_read',
  name: 'Airtable Read Records',
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
    maxRecords: {
      type: 'number',
      required: false,
      description: 'Maximum number of records to return',
    },
    filterFormula: {
      type: 'string',
      required: false,
      description: 'Formula to filter records',
    },
  },
  
  request: {
    url: (params) => {
      const url = `https://api.airtable.com/v0/${params.baseId}/${params.tableId}`
      const queryParams = new URLSearchParams()
      if (params.maxRecords) queryParams.append('maxRecords', params.maxRecords.toString())
      if (params.filterFormula) {
        const encodedFormula = encodeURIComponent(params.filterFormula).replace(/'/g, '%27')
        queryParams.append('filterByFormula', encodedFormula)
      }
      const queryString = queryParams.toString()
      return queryString ? `${url}?${queryString}` : url
    },
    method: 'GET',
    headers: (params) => ({
      'Authorization': `Bearer ${params.accessToken}`,
      'Content-Type': 'application/json',
    }),
  },
  
  transformResponse: async (response) => {
    const data = await response.json()
    return {
      success: true,
      output: {
        records: data.records,
        metadata: {
          offset: data.offset,
          totalRecords: data.records.length,
        },
      },
    }
  },
  
  transformError: (error) => {
    return `Failed to read Airtable records: ${error.message}`
  },
} 