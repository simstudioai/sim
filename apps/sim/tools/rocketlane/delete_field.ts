import {
  ROCKETLANE_API_BASE,
  type RocketlaneDeleteFieldParams,
  type RocketlaneFieldDeleteResponse,
  rocketlaneError,
  rocketlaneHeaders,
} from '@/tools/rocketlane/types'
import type { ToolConfig } from '@/tools/types'

export const rocketlaneDeleteFieldTool: ToolConfig<
  RocketlaneDeleteFieldParams,
  RocketlaneFieldDeleteResponse
> = {
  id: 'rocketlane_delete_field',
  name: 'Rocketlane Delete Field',
  description: 'Permanently delete a Rocketlane field by ID',
  version: '1.0.0',

  params: {
    apiKey: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'Rocketlane API key',
    },
    fieldId: {
      type: 'number',
      required: true,
      visibility: 'user-or-llm',
      description: 'ID of the field to delete',
    },
  },

  request: {
    url: (params) => `${ROCKETLANE_API_BASE}/fields/${encodeURIComponent(String(params.fieldId))}`,
    method: 'DELETE',
    headers: (params) => rocketlaneHeaders(params.apiKey),
  },

  transformResponse: async (response: Response, params?: RocketlaneDeleteFieldParams) => {
    if (!response.ok) {
      throw new Error(await rocketlaneError(response))
    }
    return {
      success: true,
      output: { deleted: true, fieldId: params?.fieldId ?? null },
    }
  },

  outputs: {
    deleted: { type: 'boolean', description: 'Whether the field was deleted' },
    fieldId: { type: 'number', description: 'ID of the deleted field', optional: true },
  },
}
