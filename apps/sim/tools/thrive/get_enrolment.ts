import type { ThriveEnrolmentResponse, ThriveGetEnrolmentParams } from '@/tools/thrive/types'
import { THRIVE_ENROLMENT_OUTPUT_PROPERTIES } from '@/tools/thrive/types'
import { getThriveBaseUrl, getThriveHeaders, parseThriveResponse } from '@/tools/thrive/utils'
import type { ToolConfig } from '@/tools/types'

export const getEnrolmentTool: ToolConfig<ThriveGetEnrolmentParams, ThriveEnrolmentResponse> = {
  id: 'thrive_get_enrolment',
  name: 'Thrive Get Enrolment',
  description: 'Get a single enrolment for a compliance assignment in Thrive.',
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
    enrolmentId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'The enrolment ID',
    },
  },

  request: {
    url: (params) =>
      `${getThriveBaseUrl(params.host, 'v1')}/assignments/${encodeURIComponent(params.assignmentId)}/enrolments/${encodeURIComponent(params.enrolmentId)}`,
    method: 'GET',
    headers: (params) => getThriveHeaders(params.tenantId, params.apiKey),
  },

  transformResponse: async (response: Response): Promise<ThriveEnrolmentResponse> => {
    const data = await parseThriveResponse(response, 'Failed to get enrolment')
    return { success: true, output: { enrolment: data ?? null } }
  },

  outputs: {
    enrolment: {
      type: 'object',
      description: 'The enrolment',
      properties: THRIVE_ENROLMENT_OUTPUT_PROPERTIES,
    },
  },
}
