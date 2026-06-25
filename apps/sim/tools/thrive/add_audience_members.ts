import type { ThriveAddUsersResponse, ThriveAudienceUsersParams } from '@/tools/thrive/types'
import { THRIVE_ADD_USERS_OUTPUT_PROPERTIES } from '@/tools/thrive/types'
import {
  getThriveBaseUrl,
  getThriveHeaders,
  parseThriveArray,
  parseThriveResponse,
} from '@/tools/thrive/utils'
import type { ToolConfig } from '@/tools/types'

export const addAudienceMembersTool: ToolConfig<ThriveAudienceUsersParams, ThriveAddUsersResponse> =
  {
    id: 'thrive_add_audience_members',
    name: 'Thrive Add Audience Members',
    description: 'Add members to a Thrive audience by email, ref, or id.',
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
      users: {
        type: 'string',
        required: true,
        visibility: 'user-or-llm',
        description:
          'JSON array of user emails/refs/ids to add (1-100). Example: ["user@example.com"]',
      },
    },

    request: {
      url: (params) =>
        `${getThriveBaseUrl(params.host, 'v1')}/audiences/${encodeURIComponent(params.audienceId)}/members`,
      method: 'POST',
      headers: (params) => getThriveHeaders(params.tenantId, params.apiKey),
      body: (params) => JSON.stringify(parseThriveArray<string>(params.users)),
    },

    transformResponse: async (response: Response): Promise<ThriveAddUsersResponse> => {
      const data = await parseThriveResponse(response, 'Failed to add audience members')
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
