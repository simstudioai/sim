import {
  ROCKETLANE_API_BASE,
  type RocketlaneDeletePhaseParams,
  type RocketlanePhaseDeleteResponse,
  rocketlaneError,
  rocketlaneHeaders,
} from '@/tools/rocketlane/types'
import type { ToolConfig } from '@/tools/types'

export const rocketlaneDeletePhaseTool: ToolConfig<
  RocketlaneDeletePhaseParams,
  RocketlanePhaseDeleteResponse
> = {
  id: 'rocketlane_delete_phase',
  name: 'Rocketlane Delete Phase',
  description: 'Permanently delete a Rocketlane phase by ID',
  version: '1.0.0',

  params: {
    apiKey: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'Rocketlane API key',
    },
    phaseId: {
      type: 'number',
      required: true,
      visibility: 'user-or-llm',
      description: 'ID of the phase to delete',
    },
  },

  request: {
    url: (params) => `${ROCKETLANE_API_BASE}/phases/${encodeURIComponent(String(params.phaseId))}`,
    method: 'DELETE',
    headers: (params) => rocketlaneHeaders(params.apiKey),
  },

  transformResponse: async (response: Response, params?: RocketlaneDeletePhaseParams) => {
    if (!response.ok) {
      throw new Error(await rocketlaneError(response))
    }
    return {
      success: true,
      output: { deleted: true, phaseId: params?.phaseId ?? null },
    }
  },

  outputs: {
    deleted: { type: 'boolean', description: 'Whether the phase was deleted' },
    phaseId: { type: 'number', description: 'ID of the deleted phase', optional: true },
  },
}
