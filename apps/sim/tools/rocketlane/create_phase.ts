import {
  mapPhase,
  PHASE_OUTPUT_PROPERTIES,
  ROCKETLANE_API_BASE,
  type RocketlaneCreatePhaseParams,
  type RocketlanePhaseResponse,
  rocketlaneError,
  rocketlaneHeaders,
} from '@/tools/rocketlane/types'
import type { ToolConfig } from '@/tools/types'

export const rocketlaneCreatePhaseTool: ToolConfig<
  RocketlaneCreatePhaseParams,
  RocketlanePhaseResponse
> = {
  id: 'rocketlane_create_phase',
  name: 'Rocketlane Create Phase',
  description: 'Create a new phase in a Rocketlane project',
  version: '1.0.0',

  params: {
    apiKey: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'Rocketlane API key',
    },
    phaseName: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Name of the phase',
    },
    projectId: {
      type: 'number',
      required: true,
      visibility: 'user-or-llm',
      description: 'ID of the project to create the phase in',
    },
    startDate: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Planned start date of the phase (YYYY-MM-DD)',
    },
    dueDate: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Planned due date of the phase (YYYY-MM-DD)',
    },
    statusValue: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Numeric status value to set on the phase',
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
      const url = new URL(`${ROCKETLANE_API_BASE}/phases`)
      if (params.includeFields) url.searchParams.set('includeFields', params.includeFields)
      if (params.includeAllFields != null) {
        url.searchParams.set('includeAllFields', String(params.includeAllFields))
      }
      return url.toString()
    },
    method: 'POST',
    headers: (params) => rocketlaneHeaders(params.apiKey),
    body: (params) => ({
      phaseName: params.phaseName,
      project: { projectId: params.projectId },
      startDate: params.startDate,
      dueDate: params.dueDate,
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
      description: 'The created phase',
      properties: PHASE_OUTPUT_PROPERTIES,
    },
  },
}
