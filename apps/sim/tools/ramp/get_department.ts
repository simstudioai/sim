import type { RampGetDepartmentParams, RampGetDepartmentResponse } from '@/tools/ramp/types'
import { buildRampHeaders, buildRampUrl, extractRampError } from '@/tools/ramp/utils'
import type { ToolConfig } from '@/tools/types'

export const rampGetDepartmentTool: ToolConfig<RampGetDepartmentParams, RampGetDepartmentResponse> =
  {
    id: 'ramp_get_department',
    name: 'Ramp Get Department',
    description: 'Retrieve a single Ramp department by ID',
    version: '1.0.0',

    oauth: {
      required: true,
      provider: 'ramp',
    },

    params: {
      accessToken: {
        type: 'string',
        required: true,
        visibility: 'hidden',
        description: 'OAuth access token for the Ramp API',
      },
      departmentId: {
        type: 'string',
        required: true,
        visibility: 'user-or-llm',
        description: 'ID of the department to retrieve',
      },
    },

    request: {
      url: (params) =>
        buildRampUrl(`/departments/${encodeURIComponent(params.departmentId.trim())}`),
      method: 'GET',
      headers: (params) => buildRampHeaders(params),
    },

    transformResponse: async (response): Promise<RampGetDepartmentResponse> => {
      const data = await response.json()

      if (!response.ok) {
        return {
          success: false,
          error: extractRampError(data, 'Failed to get Ramp department'),
          output: {},
        }
      }

      return {
        success: true,
        output: {
          department: data,
        },
      }
    },

    outputs: {
      department: {
        type: 'object',
        description: 'The requested Ramp department',
        properties: {
          id: { type: 'string', description: 'Unique identifier for the department' },
          name: { type: 'string', description: 'Name of the department' },
        },
      },
    },
  }
