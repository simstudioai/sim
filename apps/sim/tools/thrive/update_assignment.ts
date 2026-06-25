import type { ThriveAssignmentResponse, ThriveUpdateAssignmentParams } from '@/tools/thrive/types'
import { THRIVE_ASSIGNMENT_OUTPUT_PROPERTIES } from '@/tools/thrive/types'
import {
  getThriveBaseUrl,
  getThriveHeaders,
  parseThriveArray,
  parseThriveResponse,
} from '@/tools/thrive/utils'
import type { ToolConfig } from '@/tools/types'

export const updateAssignmentTool: ToolConfig<
  ThriveUpdateAssignmentParams,
  ThriveAssignmentResponse
> = {
  id: 'thrive_update_assignment',
  name: 'Thrive Update Assignment',
  description: 'Update a compliance assignment in Thrive.',
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
    contentId: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'The content ID for the primary content',
    },
    completionPeriod: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'The number of days required to complete the assignment',
    },
    recurrence: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'The number of days until the assignment will reoccur',
    },
    alternativeContentIds: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'JSON array of content IDs that can also complete the assignment',
    },
  },

  request: {
    url: (params) =>
      `${getThriveBaseUrl(params.host, 'v1')}/assignments/${encodeURIComponent(params.assignmentId)}`,
    method: 'PATCH',
    headers: (params) => getThriveHeaders(params.tenantId, params.apiKey),
    body: (params) => {
      const body: Record<string, any> = {
        audienceId: params.audienceId,
      }
      if (params.contentId) body.contentId = params.contentId
      if (params.completionPeriod !== undefined) body.completionPeriod = params.completionPeriod
      if (params.recurrence !== undefined) body.recurrence = params.recurrence
      if (params.alternativeContentIds) {
        body.alternativeContentIds = parseThriveArray<string>(
          params.alternativeContentIds,
          'alternativeContentIds'
        )
      }
      return body
    },
  },

  transformResponse: async (response: Response): Promise<ThriveAssignmentResponse> => {
    const data = await parseThriveResponse(response, 'Failed to update assignment')
    return { success: true, output: { assignment: data ?? null } }
  },

  outputs: {
    assignment: {
      type: 'object',
      description: 'The updated assignment',
      properties: THRIVE_ASSIGNMENT_OUTPUT_PROPERTIES,
    },
  },
}
