import type { ThriveAddUsersResponse, ThriveAudienceManagersParams } from '@/tools/thrive/types'
import { THRIVE_ADD_USERS_OUTPUT_PROPERTIES } from '@/tools/thrive/types'
import {
  getThriveBaseUrl,
  getThriveHeaders,
  parseThriveArray,
  parseThriveResponse,
} from '@/tools/thrive/utils'
import type { ToolConfig } from '@/tools/types'

export const replaceAudienceManagersTool: ToolConfig<
  ThriveAudienceManagersParams,
  ThriveAddUsersResponse
> = {
  id: 'thrive_replace_audience_managers',
  name: 'Thrive Replace Audience Managers',
  description:
    "Replace a Thrive audience's entire manager list with the given managers (does not support an empty array).",
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
    managers: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description:
        'JSON array of manager objects that replaces the whole manager list (1-100, no empty array). Each: {"reference":"user@example.com","permissions":{"audienceManager":{"manageContent":true,"assignments":true},"peopleManager":{"canViewLearnPage":true,"insights":false,"manage":false},"administrator":{"canAddAudienceManagers":false}}}',
    },
  },

  request: {
    url: (params) =>
      `${getThriveBaseUrl(params.host, 'v1')}/audiences/${encodeURIComponent(params.audienceId)}/managers`,
    method: 'PATCH',
    headers: (params) => getThriveHeaders(params.tenantId, params.apiKey),
    body: (params) => JSON.stringify(parseThriveArray(params.managers)),
  },

  transformResponse: async (response: Response): Promise<ThriveAddUsersResponse> => {
    const data = await parseThriveResponse(response, 'Failed to replace audience managers')
    return {
      success: true,
      output: { result: { success: data?.success ?? null, failure: data?.failure } },
    }
  },

  outputs: {
    result: {
      type: 'object',
      description:
        'The add/replace result, with successfully and unsuccessfully processed entities',
      properties: THRIVE_ADD_USERS_OUTPUT_PROPERTIES,
    },
  },
}
