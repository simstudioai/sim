import type { ThriveAssignmentResponse, ThriveGetAssignmentParams } from '@/tools/thrive/types'
import { THRIVE_ASSIGNMENT_OUTPUT_PROPERTIES } from '@/tools/thrive/types'
import { getThriveBaseUrl, getThriveHeaders, parseThriveResponse } from '@/tools/thrive/utils'
import type { ToolConfig } from '@/tools/types'

export const getAssignmentTool: ToolConfig<ThriveGetAssignmentParams, ThriveAssignmentResponse> = {
  id: 'thrive_get_assignment',
  name: 'Thrive Get Assignment',
  description: 'Get a single compliance assignment in Thrive by its ID.',
  version: '1.0.0',

  params: {
    tenantId: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'Thrive Tenant ID (used as the Basic auth username)',
    },
    apiKey: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'Thrive API key (used as the Basic auth password)',
    },
    host: {
      type: 'string',
      required: false,
      visibility: 'user-only',
      description: 'Region-specific API host',
    },
    assignmentId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'The assignment ID',
    },
  },

  request: {
    url: (params) =>
      `${getThriveBaseUrl(params.host, 'v1')}/assignments/${encodeURIComponent(params.assignmentId)}`,
    method: 'GET',
    headers: (params) => getThriveHeaders(params.tenantId, params.apiKey),
  },

  transformResponse: async (response: Response): Promise<ThriveAssignmentResponse> => {
    const data = await parseThriveResponse(response, 'Failed to get assignment')
    return { success: true, output: { assignment: data ?? null } }
  },

  outputs: {
    assignment: {
      type: 'object',
      description: 'The assignment',
      properties: THRIVE_ASSIGNMENT_OUTPUT_PROPERTIES,
    },
  },
}
