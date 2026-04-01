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
      output: { id: (data.id as string) ?? '', data },
    }
  },
  outputs: {
    id: { type: 'string', description: 'Setting ID' },
    data: { type: 'json', description: 'Full setting data' },
  },
}
