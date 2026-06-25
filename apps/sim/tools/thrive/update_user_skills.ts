import type { ThriveMessageResponse, ThriveUpdateUserSkillsParams } from '@/tools/thrive/types'
import {
  getThriveBaseUrl,
  getThriveHeaders,
  parseThriveArray,
  parseThriveResponse,
} from '@/tools/thrive/utils'
import type { ToolConfig } from '@/tools/types'

export const updateUserSkillsTool: ToolConfig<ThriveUpdateUserSkillsParams, ThriveMessageResponse> =
  {
    id: 'thrive_update_user_skills',
    name: 'Thrive Update User Skills',
    description: 'Update skills and levels for a learner in Thrive.',
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
      userId: {
        type: 'string',
        required: true,
        visibility: 'user-or-llm',
        description: 'The learner ID',
      },
      skills: {
        type: 'string',
        required: true,
        visibility: 'user-or-llm',
        description:
          'JSON array of skill objects (1-100). Each: {"tagName":"leadership","level":1,"targetLevel":3}. level/targetLevel optional (min -1).',
      },
    },

    request: {
      url: (params) =>
        `${getThriveBaseUrl(params.host, 'v1')}/users/${encodeURIComponent(params.userId)}/skills`,
      method: 'PATCH',
      headers: (params) => getThriveHeaders(params.tenantId, params.apiKey),
      body: (params) => ({
        op: 'update',
        path: 'skills',
        value: parseThriveArray(params.skills, 'skills'),
      }),
    },

    transformResponse: async (response: Response): Promise<ThriveMessageResponse> => {
      const data = await parseThriveResponse(response, 'Failed to update skills for learner')
      return {
        success: true,
        output: { status: data?.status ?? null, message: data?.message ?? null },
      }
    },

    outputs: {
      status: { type: 'number', description: 'The HTTP status code of the operation' },
      message: { type: 'string', description: 'A human-readable result message' },
    },
  }
