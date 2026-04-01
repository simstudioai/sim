import type { RipplingCreateCustomSettingParams } from '@/tools/rippling/types'
import type { ToolConfig } from '@/tools/types'

export const ripplingCreateCustomSettingTool: ToolConfig<RipplingCreateCustomSettingParams> = {
  id: 'rippling_create_custom_setting',
  name: 'Rippling Create Custom Setting',
  description: 'Create a new custom setting',
  version: '1.0.0',
  params: {
    apiKey: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'Rippling API key',
    },
    data: { type: 'json', required: true, visibility: 'user-or-llm', description: 'Setting data' },
  },
  request: {
    url: `https://rest.ripplingapis.com/custom-settings/`,
    method: 'POST',
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
    id: { type: 'string', description: 'Setting ID' },
    created_at: { type: 'string', description: 'Created timestamp', optional: true },
    updated_at: { type: 'string', description: 'Updated timestamp', optional: true },
    display_name: { type: 'string', description: 'Display name', optional: true },
    api_name: { type: 'string', description: 'API name', optional: true },
    data_type: { type: 'string', description: 'Data type', optional: true },
    secret_value: { type: 'string', description: 'Secret value', optional: true },
    string_value: { type: 'string', description: 'String value', optional: true },
    number_value: { type: 'number', description: 'Number value', optional: true },
    boolean_value: { type: 'boolean', description: 'Boolean value', optional: true },
  },
}
