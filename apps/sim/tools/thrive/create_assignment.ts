import type { ThriveAssignmentResponse, ThriveCreateAssignmentParams } from '@/tools/thrive/types'
import { THRIVE_ASSIGNMENT_OUTPUT_PROPERTIES } from '@/tools/thrive/types'
import {
  getThriveBaseUrl,
  getThriveHeaders,
  parseThriveArray,
  parseThriveResponse,
} from '@/tools/thrive/utils'
import type { ToolConfig } from '@/tools/types'

export const createAssignmentTool: ToolConfig<
  ThriveCreateAssignmentParams,
  ThriveAssignmentResponse
> = {
  id: 'thrive_create_assignment',
  name: 'Thrive Create Assignment',
  description: 'Create a compliance assignment in Thrive for an audience and content item.',
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
    audienceId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'The audience ID',
    },
    contentId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'The content ID for the primary content',
    },
    alternativeContentIds: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'JSON array of content IDs that can also complete the assignment',
    },
    hideAlternativeContent: {
      type: 'boolean',
      required: false,
      visibility: 'user-or-llm',
      description: 'Whether to hide the alternative content',
    },
    completionPeriod: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'The number of days required to complete the assignment (default 30)',
    },
    recurrence: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'The number of days until the assignment will reoccur',
    },
  },

  request: {
    url: (params) => `${getThriveBaseUrl(params.host, 'v1')}/assignments`,
    method: 'POST',
    headers: (params) => getThriveHeaders(params.tenantId, params.apiKey),
    body: (params) => {
      const body: Record<string, any> = {
        audienceId: params.audienceId,
        contentId: params.contentId,
      }
      if (params.alternativeContentIds) {
        body.alternativeContentIds = parseThriveArray<string>(params.alternativeContentIds)
      }
      if (params.hideAlternativeContent !== undefined) {
        body.hideAlternativeContent = params.hideAlternativeContent
      }
      if (params.completionPeriod !== undefined) body.completionPeriod = params.completionPeriod
      if (params.recurrence !== undefined) body.recurrence = params.recurrence
      return body
    },
  },

  transformResponse: async (response: Response): Promise<ThriveAssignmentResponse> => {
    const data = await parseThriveResponse(response, 'Failed to create assignment')
    return { success: true, output: { assignment: data ?? null } }
  },

  outputs: {
    assignment: {
      type: 'object',
      description: 'The created assignment',
      properties: THRIVE_ASSIGNMENT_OUTPUT_PROPERTIES,
    },
  },
}
