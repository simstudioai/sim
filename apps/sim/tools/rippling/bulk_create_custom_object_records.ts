import type { RipplingBulkCreateCustomObjectRecordsParams } from '@/tools/rippling/types'
import type { ToolConfig } from '@/tools/types'

export const ripplingBulkCreateCustomObjectRecordsTool: ToolConfig<RipplingBulkCreateCustomObjectRecordsParams> =
  {
    id: 'rippling_bulk_create_custom_object_records',
    name: 'Rippling Bulk Create Custom Object Records',
    description: 'Bulk create custom object records',
    version: '1.0.0',
    params: {
      apiKey: {
        type: 'string',
        required: true,
        visibility: 'user-only',
        description: 'Rippling API key',
      },
      customObjectApiName: {
        type: 'string',
        required: true,
        visibility: 'user-or-llm',
        description: 'Custom object API name',
      },
      rowsToWrite: {
        type: 'json',
        required: true,
        visibility: 'user-or-llm',
        description: 'Array of records to create [{external_id?, data}]',
      },
      allOrNothing: {
        type: 'boolean',
        required: false,
        visibility: 'user-or-llm',
        description: 'If true, fail entire batch on any error',
      },
    },
    request: {
      url: (params) =>
        `https://rest.ripplingapis.com/custom-objects/${encodeURIComponent(params.customObjectApiName.trim())}/records/bulk/`,
      method: 'POST',
      headers: (params) => ({
        Authorization: `Bearer ${params.apiKey}`,
        'Content-Type': 'application/json',
        Accept: 'application/json',
      }),
      body: (params) => {
        const body: Record<string, unknown> = { rows_to_write: params.rowsToWrite }
        if (params.allOrNothing != null) body.all_or_nothing = params.allOrNothing
        return body
      },
    },
    transformResponse: async (response: Response) => {
      if (!response.ok) {
        const errorText = await response.text()
        throw new Error(`Rippling API error (${response.status}): ${errorText}`)
      }
      const data = await response.json()
      const createdRecords = data.data ?? []
      return {
        success: true,
        output: {
          createdRecords,
          totalCount: Array.isArray(createdRecords) ? createdRecords.length : 0,
        },
      }
    },
    outputs: {
      createdRecords: { type: 'array', description: 'Created custom object records' },
      totalCount: { type: 'number', description: 'Number of records created' },
    },
  }
