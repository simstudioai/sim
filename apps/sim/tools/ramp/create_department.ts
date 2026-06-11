import type { RampCreateDepartmentParams, RampCreateDepartmentResponse } from '@/tools/ramp/types'
import { buildRampHeaders, buildRampUrl, extractRampError } from '@/tools/ramp/utils'
import type { ToolConfig } from '@/tools/types'

export const rampCreateDepartmentTool: ToolConfig<
  RampCreateDepartmentParams,
  RampCreateDepartmentResponse
> = {
  id: 'ramp_create_department',
  name: 'Ramp Create Department',
  description: 'Create a new department in the Ramp business',
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
    departmentName: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Name of the department to create',
    },
  },

  request: {
    url: () => buildRampUrl('/departments'),
    method: 'POST',
    headers: (params) => ({
      ...buildRampHeaders(params),
      'Content-Type': 'application/json',
    }),
    body: (params) => ({
      name: params.departmentName,
    }),
  },

  transformResponse: async (response): Promise<RampCreateDepartmentResponse> => {
    const data = await response.json()

    if (!response.ok) {
      return {
        success: false,
        error: extractRampError(data, 'Failed to create Ramp department'),
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
      description: 'The created Ramp department',
      properties: {
        id: { type: 'string', description: 'Unique identifier for the department' },
        name: { type: 'string', description: 'Name of the department' },
      },
    },
  },
}
