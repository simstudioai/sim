import type { RipplingUpdateCustomSettingParams } from '@/tools/rippling/types'
import { CUSTOM_SETTING_OUTPUT_PROPERTIES } from '@/tools/rippling/types'
import type { ToolConfig } from '@/tools/types'

export const ripplingUpdateCustomSettingTool: ToolConfig<RipplingUpdateCustomSettingParams> = {
  id: 'rippling_update_custom_setting',
  name: 'Rippling Update Custom Setting',
  description: 'Update a custom setting',
  version: '1.0.0',
  params: {
    apiKey: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'Rippling API key',
    },
    id: { type: 'string', required: true, visibility: 'user-or-llm', description: 'Setting ID' },
    displayName: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Display name',
    },
    apiName: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Unique API name',
    },
    dataType: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Data type of the setting',
    },
    secretValue: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Secret value (for secret data type)',
    },
    stringValue: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'String value (for string data type)',
    },
    numberValue: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Number value (for number data type)',
    },
    booleanValue: {
      type: 'boolean',
      required: false,
      visibility: 'user-or-llm',
      description: 'Boolean value (for boolean data type)',
    },
  },
  request: {
    url: (params) =>
      `https://rest.ripplingapis.com/custom-settings/${encodeURIComponent(params.id.trim())}/`,
    method: 'PATCH',
    headers: (params) => ({
      Authorization: `Bearer ${params.apiKey}`,
      'Content-Type': 'application/json',
      Accept: 'application/json',
    }),
    body: (params) => {
      const body: Record<string, unknown> = {}
      if (params.displayName != null) body.display_name = params.displayName
      if (params.apiName != null) body.api_name = params.apiName
      if (params.dataType != null) body.data_type = params.dataType
      if (params.secretValue != null) body.secret_value = params.secretValue
      if (params.stringValue != null) body.string_value = params.stringValue
      if (params.numberValue != null) body.number_value = params.numberValue
      if (params.booleanValue != null) body.boolean_value = params.booleanValue
      return body
    },
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
        display_name: (data.display_name as string) ?? null,
        api_name: (data.api_name as string) ?? null,
        data_type: (data.data_type as string) ?? null,
        secret_value: (data.secret_value as string) ?? null,
        string_value: (data.string_value as string) ?? null,
        number_value: data.number_value ?? null,
        boolean_value: data.boolean_value ?? null,
      },
    }
  },
  outputs: {
    ...CUSTOM_SETTING_OUTPUT_PROPERTIES,
  },
}
