import { createLogger } from '@sim/logger'
import type { ToolConfig } from '@/tools/types'
import type { AttioGetMemberParams, AttioGetMemberResponse } from './types'
import { MEMBER_OUTPUT_PROPERTIES } from './types'

const logger = createLogger('AttioGetMember')

export const attioGetMemberTool: ToolConfig<AttioGetMemberParams, AttioGetMemberResponse> = {
  id: 'attio_get_member',
  name: 'Attio Get Member',
  description: 'Get a single workspace member by ID',
  version: '1.0.0',

  oauth: {
    required: true,
    provider: 'attio',
  },

  params: {
    accessToken: {
      type: 'string',
      required: true,
      visibility: 'hidden',
      description: 'The OAuth access token for the Attio API',
    },
    memberId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'The workspace member ID',
    },
  },

  request: {
    url: (params) => `https://api.attio.com/v2/workspace_members/${params.memberId}`,
    method: 'GET',
    headers: (params) => ({
      Authorization: `Bearer ${params.accessToken}`,
    }),
  },

  transformResponse: async (response) => {
    const data = await response.json()
    if (!response.ok) {
      logger.error('Attio API request failed', { data, status: response.status })
      throw new Error(data.message || 'Failed to get workspace member')
    }
    const m = data.data
    return {
      success: true,
      output: {
        memberId: m.id?.workspace_member_id ?? null,
        firstName: m.first_name ?? null,
        lastName: m.last_name ?? null,
        avatarUrl: m.avatar_url ?? null,
        emailAddress: m.email_address ?? null,
        accessLevel: m.access_level ?? null,
        createdAt: m.created_at ?? null,
      },
    }
  },

  outputs: MEMBER_OUTPUT_PROPERTIES,
}
