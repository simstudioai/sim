import type { RipplingUpdateCustomObjectRecordParams } from '@/tools/rippling/types'
import type { ToolConfig } from '@/tools/types'

export const ripplingUpdateCustomObjectRecordTool: ToolConfig<RipplingUpdateCustomObjectRecordParams> =
  {
    id: 'rippling_update_custom_object_record',
    name: 'Rippling Update Custom Object Record',
    description: 'Update a custom object record',
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
      codrId: {
        type: 'string',
        required: true,
        visibility: 'user-or-llm',
        description: 'Record ID',
      },
      data: {
        type: 'json',
        required: true,
        visibility: 'user-or-llm',
        description: 'Updated record data',
      },
    },
    request: {
      url: (params) =>
        `https://rest.ripplingapis.com/custom-objects/${encodeURIComponent(params.customObjectApiName.trim())}/records/${encodeURIComponent(params.codrId.trim())}/`,
      method: 'PATCH',
      headers: (params) => ({
        Authorization: `Bearer ${params.apiKey}`,
        'Content-Type': 'application/json',
        Accept: 'application/json',
      }),
      body: (params) => {
        return params.data as Record<string, unknown>
      },
    },
    transformResponse: async (response: Response) => {
      if (!response.ok) {
        const errorText = await response.text()
        throw new Error(`Rippling API error (${response.status}): ${errorText}`)
      }
      const json = await response.json()
      const record = json.data ?? json
      return {
        success: true,
        output: {
          id: (record.id as string) ?? '',
          created_at: (record.created_at as string) ?? null,
          updated_at: (record.updated_at as string) ?? null,
          name: (record.name as string) ?? null,
          external_id: (record.external_id as string) ?? null,
          created_by: record.created_by ?? null,
          last_modified_by: record.last_modified_by ?? null,
          owner_role: record.owner_role ?? null,
          system_updated_at: (record.system_updated_at as string) ?? null,
          data: record,
        },
      }
    },
    outputs: {
      id: { type: 'string', description: 'Record ID' },
      created_at: { type: 'string', description: 'Creation date', optional: true },
      updated_at: { type: 'string', description: 'Update date', optional: true },
      name: { type: 'string', description: 'Record name', optional: true },
      external_id: { type: 'string', description: 'External ID', optional: true },
      created_by: { type: 'json', description: 'Created by user', optional: true },
      last_modified_by: { type: 'json', description: 'Last modified by user', optional: true },
      owner_role: { type: 'json', description: 'Owner role', optional: true },
      system_updated_at: { type: 'string', description: 'System update timestamp', optional: true },
      data: { type: 'json', description: 'Full record data' },
    },
  }
