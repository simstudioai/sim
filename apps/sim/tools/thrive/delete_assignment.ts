import type { ThriveDeleteAssignmentParams, ThriveDeleteResponse } from '@/tools/thrive/types'
import { getThriveBaseUrl, getThriveHeaders, parseThriveResponse } from '@/tools/thrive/utils'
import type { ToolConfig } from '@/tools/types'

export const deleteAssignmentTool: ToolConfig<ThriveDeleteAssignmentParams, ThriveDeleteResponse> =
  {
    id: 'thrive_delete_assignment',
    name: 'Thrive Delete Assignment',
    description: 'Delete a compliance assignment in Thrive.',
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
      audienceId: {
        type: 'string',
        required: true,
        visibility: 'user-or-llm',
        description: 'The audience ID',
      },
    },

    request: {
      url: (params) =>
        `${getThriveBaseUrl(params.host, 'v1')}/assignments/${encodeURIComponent(params.assignmentId)}`,
      method: 'DELETE',
      headers: (params) => getThriveHeaders(params.tenantId, params.apiKey),
      body: (params) => ({ audienceId: params.audienceId }),
    },

    transformResponse: async (response: Response): Promise<ThriveDeleteResponse> => {
      const data = await parseThriveResponse(response, 'Failed to delete assignment')
      return { success: true, output: { success: data?.success ?? true } }
    },

    outputs: {
      success: { type: 'boolean', description: 'Whether the assignment was deleted' },
    },
  }
