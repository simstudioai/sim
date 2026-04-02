import type { RipplingQueryCustomObjectRecordsParams } from '@/tools/rippling/types'
import { CUSTOM_OBJECT_RECORD_OUTPUT_PROPERTIES } from '@/tools/rippling/types'
import type { ToolConfig } from '@/tools/types'

export const ripplingQueryCustomObjectRecordsTool: ToolConfig<RipplingQueryCustomObjectRecordsParams> =
  {
    id: 'rippling_query_custom_object_records',
    name: 'Rippling Query Custom Object Records',
    description: 'Query custom object records with filters',
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
      query: {
        type: 'string',
        required: false,
        visibility: 'user-or-llm',
        description: 'Query expression',
      },
      limit: {
        type: 'number',
        required: false,
        visibility: 'user-or-llm',
        description: 'Maximum number of records to return',
      },
      cursor: {
        type: 'string',
        required: false,
        visibility: 'user-or-llm',
        description: 'Pagination cursor',
      },
    },
    request: {
      url: (params) =>
        `https://rest.ripplingapis.com/custom-objects/${encodeURIComponent(params.customObjectApiName.trim())}/records/query/`,
      method: 'POST',
      headers: (params) => ({
        Authorization: `Bearer ${params.apiKey}`,
        'Content-Type': 'application/json',
        Accept: 'application/json',
      }),
      body: (params) => {
        const body: Record<string, unknown> = {}
        if (params.query != null) body.query = params.query
        if (params.limit != null) body.limit = params.limit
        if (params.cursor != null) body.cursor = params.cursor
        return body
      },
    },
    transformResponse: async (response: Response) => {
      if (!response.ok) {
        const errorText = await response.text()
        throw new Error(`Rippling API error (${response.status}): ${errorText}`)
      }
      const data = await response.json()
      const results = data.results ?? []
      return {
        success: true,
        output: {
          records: results.map((item: Record<string, unknown>) => {
            const {
              id,
              created_at,
              updated_at,
              name,
              external_id,
              created_by,
              last_modified_by,
              owner_role,
              system_updated_at,
              ...dynamicFields
            } = item
            return {
              id: (id as string) ?? '',
              created_at: (created_at as string) ?? null,
              updated_at: (updated_at as string) ?? null,
              name: (name as string) ?? null,
              external_id: (external_id as string) ?? null,
              created_by: created_by ?? null,
              last_modified_by: last_modified_by ?? null,
              owner_role: owner_role ?? null,
              system_updated_at: (system_updated_at as string) ?? null,
              data: dynamicFields,
            }
          }),
          totalCount: results.length,
          cursor: (data.cursor as string) ?? null,
        },
      }
    },
    outputs: {
      records: {
        type: 'array',
        description: 'Matching records',
        items: {
          type: 'object',
          properties: {
            ...CUSTOM_OBJECT_RECORD_OUTPUT_PROPERTIES,
            data: { type: 'json', description: 'Full record data' },
          },
        },
      },
      totalCount: { type: 'number', description: 'Number of records returned' },
      cursor: { type: 'string', description: 'Cursor for next page of results', optional: true },
    },
  }
