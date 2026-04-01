import type { RipplingBulkUpdateCustomObjectRecordsParams } from '@/tools/rippling/types'
import type { ToolConfig } from '@/tools/types'

export const ripplingBulkUpdateCustomObjectRecordsTool: ToolConfig<RipplingBulkUpdateCustomObjectRecordsParams> =
  {
    id: 'rippling_bulk_update_custom_object_records',
    name: 'Rippling Bulk Update Custom Object Records',
    description: 'Bulk update custom object records',
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
      rowsToUpdate: {
        type: 'json',
        required: true,
        visibility: 'user-or-llm',
        description: 'Array of records to update',
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
      method: 'PATCH',
      headers: (params) => ({
        Authorization: `Bearer ${params.apiKey}`,
        'Content-Type': 'application/json',
        Accept: 'application/json',
      }),
      body: (params) => {
        const body: Record<string, unknown> = { rows_to_update: params.rowsToUpdate }
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
      const results = data.data ?? data.results ?? []
      return {
        success: true,
        output: {
          results,
          totalCount: Array.isArray(results) ? results.length : 0,
        },
      }
    },
    outputs: {
      results: { type: 'json', description: 'Bulk operation results' },
      totalCount: { type: 'number', description: 'Number of records processed' },
    },
  }
