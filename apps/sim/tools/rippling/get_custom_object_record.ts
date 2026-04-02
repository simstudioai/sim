import type { RipplingGetCustomObjectRecordParams } from '@/tools/rippling/types'
import type { ToolConfig } from '@/tools/types'

export const ripplingGetCustomObjectRecordTool: ToolConfig<RipplingGetCustomObjectRecordParams> = {
  id: 'rippling_get_custom_object_record',
  name: 'Rippling Get Custom Object Record',
  description: 'Get a specific custom object record',
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
    codrId: { type: 'string', required: true, visibility: 'user-or-llm', description: 'Record ID' },
  },
  request: {
    url: (params) =>
      `https://rest.ripplingapis.com/custom-objects/${encodeURIComponent(params.customObjectApiName.trim())}/records/${encodeURIComponent(params.codrId.trim())}/`,
    method: 'GET',
    headers: (params) => ({ Authorization: `Bearer ${params.apiKey}`, Accept: 'application/json' }),
  },
  transformResponse: async (response: Response) => {
    if (!response.ok) {
      const errorText = await response.text()
      throw new Error(`Rippling API error (${response.status}): ${errorText}`)
    }
    const data = await response.json()
    return {
      success: true,
      output: {
        id: (data.id as string) ?? '',
        created_at: (data.created_at as string) ?? null,
        updated_at: (data.updated_at as string) ?? null,
        name: (data.name as string) ?? null,
        external_id: (data.external_id as string) ?? null,
        created_by: data.created_by ?? null,
        last_modified_by: data.last_modified_by ?? null,
        owner_role: data.owner_role ?? null,
        system_updated_at: (data.system_updated_at as string) ?? null,
        data,
      },
    }
  },
  outputs: {
    id: { type: 'string', description: 'Record ID' },
    created_at: { type: 'string', description: 'Created timestamp', optional: true },
    updated_at: { type: 'string', description: 'Updated timestamp', optional: true },
    name: { type: 'string', description: 'Name', optional: true },
    external_id: { type: 'string', description: 'External ID', optional: true },
    created_by: { type: 'json', description: 'Created by user', optional: true },
    last_modified_by: { type: 'json', description: 'Last modified by user', optional: true },
    owner_role: { type: 'json', description: 'Owner role', optional: true },
    system_updated_at: { type: 'string', description: 'System update timestamp', optional: true },
    data: { type: 'json', description: 'Full record data' },
  },
}
