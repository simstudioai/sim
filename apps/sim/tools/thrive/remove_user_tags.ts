import type { ThriveMessageResponse, ThriveRemoveUserTagsParams } from '@/tools/thrive/types'
import {
  getThriveBaseUrl,
  getThriveHeaders,
  parseThriveArray,
  parseThriveResponse,
} from '@/tools/thrive/utils'
import type { ToolConfig } from '@/tools/types'

export const removeUserTagsTool: ToolConfig<ThriveRemoveUserTagsParams, ThriveMessageResponse> = {
  id: 'thrive_remove_user_tags',
  name: 'Thrive Remove User Tags',
  description: 'Remove one or more tags from a learner in Thrive.',
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
    tags: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'JSON array of tag names to remove (1-100). Example: ["leadership"]',
    },
  },

  request: {
    url: (params) =>
      `${getThriveBaseUrl(params.host, 'v1')}/users/${encodeURIComponent(params.userId)}/tags`,
    method: 'PATCH',
    headers: (params) => getThriveHeaders(params.tenantId, params.apiKey),
    body: (params) => ({
      op: 'remove',
      path: 'tags',
      value: parseThriveArray<string>(params.tags, 'tags'),
    }),
  },

  transformResponse: async (response: Response): Promise<ThriveMessageResponse> => {
    const data = await parseThriveResponse(response, 'Failed to remove tags from learner')
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
