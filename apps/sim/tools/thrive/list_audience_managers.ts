import type {
  ThriveListAudienceManagersParams,
  ThriveListAudienceManagersResponse,
} from '@/tools/thrive/types'
import { THRIVE_AUDIENCE_MANAGER_OUTPUT_PROPERTIES } from '@/tools/thrive/types'
import { getThriveBaseUrl, getThriveHeaders, parseThriveResponse } from '@/tools/thrive/utils'
import type { ToolConfig } from '@/tools/types'

export const listAudienceManagersTool: ToolConfig<
  ThriveListAudienceManagersParams,
  ThriveListAudienceManagersResponse
> = {
  id: 'thrive_list_audience_managers',
  name: 'Thrive List Audience Managers',
  description: 'List the managers of a Thrive audience.',
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
      description: 'The audience id or audience reference',
    },
  },

  request: {
    url: (params) =>
      `${getThriveBaseUrl(params.host, 'v1')}/audiences/${encodeURIComponent(params.audienceId)}/managers`,
    method: 'GET',
    headers: (params) => getThriveHeaders(params.tenantId, params.apiKey),
  },

  transformResponse: async (response: Response): Promise<ThriveListAudienceManagersResponse> => {
    const data = await parseThriveResponse(response, 'Failed to list audience managers')
    return { success: true, output: { managers: Array.isArray(data) ? data : [] } }
  },

  outputs: {
    managers: {
      type: 'array',
      description: 'The audience managers',
      items: { type: 'object', properties: THRIVE_AUDIENCE_MANAGER_OUTPUT_PROPERTIES },
    },
  },
}
