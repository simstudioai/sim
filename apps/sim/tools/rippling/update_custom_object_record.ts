import type { RipplingUpdateCustomObjectRecordParams } from '@/tools/rippling/types'
import { CUSTOM_OBJECT_RECORD_OUTPUT_PROPERTIES } from '@/tools/rippling/types'
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
      externalId: {
        type: 'string',
        required: false,
        visibility: 'user-or-llm',
        description: 'External ID for the record',
      },
      data: {
        type: 'json',
        required: false,
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
        const body: Record<string, unknown> = {}
        if (params.externalId != null && params.externalId !== '')
          body.external_id = params.externalId
        if (params.data != null) body.data = params.data
        return body
      },
    },
    transformResponse: async (response: Response) => {
      if (!response.ok) {
        const errorText = await response.text()
        throw new Error(`Rippling API error (${response.status}): ${errorText}`)
      }
      const json = await response.json()
      const record = (json.data ?? json) as Record<string, unknown>
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
