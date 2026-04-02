import type { RipplingBulkDeleteCustomObjectRecordsParams } from '@/tools/rippling/types'
import type { ToolConfig } from '@/tools/types'

export const ripplingBulkDeleteCustomObjectRecordsTool: ToolConfig<RipplingBulkDeleteCustomObjectRecordsParams> =
  {
    id: 'rippling_bulk_delete_custom_object_records',
    name: 'Rippling Bulk Delete Custom Object Records',
    description: 'Bulk delete custom object records',
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
      rowsToDelete: {
        type: 'json',
        required: true,
        visibility: 'user-or-llm',
        description: 'Array of records to delete',
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
        `https://rest.ripplingapis.com/custom-objects/${encodeURIComponent(params.customObjectApiName.trim())}/records/bulk-delete/`,
      method: 'POST',
      headers: (params) => ({
        Authorization: `Bearer ${params.apiKey}`,
        'Content-Type': 'application/json',
        Accept: 'application/json',
      }),
      body: (params) => {
        const body: Record<string, unknown> = { rows_to_delete: params.rowsToDelete }
        if (params.allOrNothing != null) body.all_or_nothing = params.allOrNothing
        return body
      },
    },
    transformResponse: async (response: Response) => {
      if (!response.ok) {
        const errorText = await response.text()
        throw new Error(`Rippling API error (${response.status}): ${errorText}`)
      }
      return {
        success: true,
        output: { deleted: true },
      }
    },
    outputs: {
      deleted: { type: 'boolean', description: 'Whether the bulk delete succeeded' },
    },
  }
