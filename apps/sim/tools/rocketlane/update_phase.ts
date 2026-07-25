import {
  mapPhase,
  PHASE_OUTPUT_PROPERTIES,
  ROCKETLANE_API_BASE,
  type RocketlanePhaseResponse,
  type RocketlaneUpdatePhaseParams,
  rocketlaneError,
  rocketlaneHeaders,
} from '@/tools/rocketlane/types'
import type { ToolConfig } from '@/tools/types'

export const rocketlaneUpdatePhaseTool: ToolConfig<
  RocketlaneUpdatePhaseParams,
  RocketlanePhaseResponse
> = {
  id: 'rocketlane_update_phase',
  name: 'Rocketlane Update Phase',
  description: 'Update the name, dates, status, or privacy of an existing Rocketlane phase',
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
      description: 'ID of the phase to update',
    },
    phaseName: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'New name of the phase',
    },
    startDate: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'New planned start date of the phase (YYYY-MM-DD)',
    },
    dueDate: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'New planned due date of the phase (YYYY-MM-DD)',
    },
    statusValue: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'New numeric status value for the phase',
    },
    private: {
      type: 'boolean',
      required: false,
      visibility: 'user-or-llm',
      description: 'Whether the phase is private',
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
    method: 'PUT',
    headers: (params) => rocketlaneHeaders(params.apiKey),
    body: (params) => ({
      ...(params.phaseName != null && { phaseName: params.phaseName }),
      ...(params.startDate != null && { startDate: params.startDate }),
      ...(params.dueDate != null && { dueDate: params.dueDate }),
      ...(params.statusValue != null && { status: { value: params.statusValue } }),
      ...(params.private != null && { private: params.private }),
    }),
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
      description: 'The updated phase',
      properties: PHASE_OUTPUT_PROPERTIES,
    },
  },
}
