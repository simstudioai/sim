import type { RipplingGetCustomObjectRecordByExternalIdParams } from '@/tools/rippling/types'
import { CUSTOM_OBJECT_RECORD_OUTPUT_PROPERTIES } from '@/tools/rippling/types'
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
      const record = await response.json()
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
      } = record
      return {
        success: true,
        output: {
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
        },
      }
    },
    outputs: {
      ...CUSTOM_OBJECT_RECORD_OUTPUT_PROPERTIES,
      data: { type: 'json', description: 'Full record data' },
    },
  }
