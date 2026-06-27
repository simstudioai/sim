import type {
  ThriveCpdRequirementResponse,
  ThriveGetCpdRequirementParams,
} from '@/tools/thrive/types'
import { THRIVE_CPD_REQUIREMENT_OUTPUT_PROPERTIES } from '@/tools/thrive/types'
import { getThriveBaseUrl, getThriveHeaders, parseThriveResponse } from '@/tools/thrive/utils'
import type { ToolConfig } from '@/tools/types'

export const getCpdRequirementTool: ToolConfig<
  ThriveGetCpdRequirementParams,
  ThriveCpdRequirementResponse
> = {
  id: 'thrive_get_cpd_requirement',
  name: 'Thrive Get CPD Requirement',
  description: 'Get a single CPD requirement summary in Thrive by its ID.',
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
    audienceRequirementId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'The CPD requirement ID',
    },
  },

  request: {
    url: (params) =>
      `${getThriveBaseUrl(params.host, 'v1')}/cpdRequirementSummaries/${encodeURIComponent(params.audienceRequirementId)}`,
    method: 'GET',
    headers: (params) => getThriveHeaders(params.tenantId, params.apiKey),
  },

  transformResponse: async (response: Response): Promise<ThriveCpdRequirementResponse> => {
    const data = await parseThriveResponse(response, 'Failed to get CPD requirement')
    return { success: true, output: { requirement: data ?? null } }
  },

  outputs: {
    requirement: {
      type: 'object',
      description: 'The CPD requirement',
      properties: THRIVE_CPD_REQUIREMENT_OUTPUT_PROPERTIES,
    },
  },
}
