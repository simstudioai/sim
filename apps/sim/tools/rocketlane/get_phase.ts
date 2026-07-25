import {
  mapPhase,
  PHASE_OUTPUT_PROPERTIES,
  ROCKETLANE_API_BASE,
  type RocketlaneGetPhaseParams,
  type RocketlanePhaseResponse,
  rocketlaneError,
  rocketlaneHeaders,
} from '@/tools/rocketlane/types'
import type { ToolConfig } from '@/tools/types'

export const rocketlaneGetPhaseTool: ToolConfig<RocketlaneGetPhaseParams, RocketlanePhaseResponse> =
  {
    id: 'rocketlane_get_phase',
    name: 'Rocketlane Get Phase',
    description: 'Retrieve a single Rocketlane phase by ID',
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
        description: 'ID of the phase to retrieve',
      },
      includeFields: {
        type: 'string',
        required: false,
        visibility: 'user-or-llm',
        description:
          'Comma-separated extra phase properties to include in the response (supported: startDateActual, dueDateActual)',
      },
      includeAllFields: {
        type: 'boolean',
        required: false,
        visibility: 'user-or-llm',
        description: 'Whether to return all phase properties in the response',
      },
    },

    request: {
      url: (params) => {
        const url = new URL(
          `${ROCKETLANE_API_BASE}/phases/${encodeURIComponent(String(params.phaseId))}`
        )
        if (params.includeFields) url.searchParams.set('includeFields', params.includeFields)
        if (params.includeAllFields != null) {
          url.searchParams.set('includeAllFields', String(params.includeAllFields))
        }
        return url.toString()
      },
      method: 'GET',
      headers: (params) => rocketlaneHeaders(params.apiKey),
    },

    transformResponse: async (response: Response) => {
      if (!response.ok) {
        throw new Error(await rocketlaneError(response))
      }
      const data = await response.json()
      return {
        success: true,
        output: { phase: mapPhase(data) },
      }
    },

    outputs: {
      phase: {
        type: 'object',
        description: 'The requested phase',
        properties: PHASE_OUTPUT_PROPERTIES,
      },
    },
  }
