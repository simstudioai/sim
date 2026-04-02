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
    data: {
      type: 'json',
      required: true,
      visibility: 'user-or-llm',
      description: 'Updated setting data',
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
    ...CUSTOM_SETTING_OUTPUT_PROPERTIES,
  },
}
