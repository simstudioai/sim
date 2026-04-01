import type { RipplingGetCustomObjectRecordByExternalIdParams } from '@/tools/rippling/types'
import type { ToolConfig } from '@/tools/types'

export const ripplingGetCustomObjectRecordByExternalIdTool: ToolConfig<RipplingGetCustomObjectRecordByExternalIdParams> =
  {
    id: 'rippling_get_custom_object_record_by_external_id',
    name: 'Rippling Get Record By External ID',
    description: 'Get a custom object record by external ID',
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
      externalId: {
        type: 'string',
        required: true,
        visibility: 'user-or-llm',
        description: 'External ID',
      },
    },
    request: {
      url: (params) =>
        `https://rest.ripplingapis.com/custom-objects/${encodeURIComponent(params.customObjectApiName.trim())}/records/external_id/${encodeURIComponent(params.externalId.trim())}/`,
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
      return {
        success: true,
        output: {
          id: (data.id as string) ?? '',
          created_at: (data.created_at as string) ?? null,
          updated_at: (data.updated_at as string) ?? null,
          name: (data.name as string) ?? null,
          external_id: (data.external_id as string) ?? null,
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
      data: { type: 'json', description: 'Full record data' },
    },
  }
