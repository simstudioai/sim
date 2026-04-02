import type { RipplingListCustomObjectRecordsParams } from '@/tools/rippling/types'
import { CUSTOM_OBJECT_RECORD_OUTPUT_PROPERTIES } from '@/tools/rippling/types'
import type { ToolConfig } from '@/tools/types'

export const ripplingListCustomObjectRecordsTool: ToolConfig<RipplingListCustomObjectRecordsParams> =
  {
    id: 'rippling_list_custom_object_records',
    name: 'Rippling List Custom Object Records',
    description: 'List all records for a custom object',
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
    },
    request: {
      url: (params) =>
        `https://rest.ripplingapis.com/custom-objects/${encodeURIComponent(params.customObjectApiName.trim())}/records/`,
      method: 'GET',
      headers: (params) => ({
        Authorization: `Bearer ${params.apiKey}`,
        Accept: 'application/json',
      }),
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
          nextLink: (data.next_link as string) ?? null,
        },
      }
    },
    outputs: {
      records: {
        type: 'array',
        description: 'List of records',
        items: {
          type: 'object',
          properties: {
            ...CUSTOM_OBJECT_RECORD_OUTPUT_PROPERTIES,
            data: { type: 'json', description: 'Full record data including dynamic fields' },
          },
        },
      },
      totalCount: { type: 'number', description: 'Number of records returned' },
      nextLink: { type: 'string', description: 'Next page link', optional: true },
    },
  }
