import { createLogger } from '@sim/logger'
import type { ToolConfig } from '@/tools/types'
import type { AttioListMembersParams, AttioListMembersResponse } from './types'
import { MEMBER_OUTPUT_PROPERTIES } from './types'

const logger = createLogger('AttioListMembers')

export const attioListMembersTool: ToolConfig<AttioListMembersParams, AttioListMembersResponse> = {
  id: 'attio_list_members',
  name: 'Attio List Members',
  description: 'List all workspace members in Attio',
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
  },

  request: {
    url: 'https://api.attio.com/v2/workspace_members',
    method: 'GET',
    headers: (params) => ({
      Authorization: `Bearer ${params.accessToken}`,
    }),
  },

  transformResponse: async (response) => {
    const data = await response.json()
    if (!response.ok) {
      logger.error('Attio API request failed', { data, status: response.status })
      throw new Error(data.message || 'Failed to list workspace members')
    }
    const members = (data.data ?? []).map((m: Record<string, unknown>) => {
      const id = m.id as { workspace_member_id?: string } | undefined
      return {
        memberId: id?.workspace_member_id ?? null,
        firstName: (m.first_name as string) ?? null,
        lastName: (m.last_name as string) ?? null,
        avatarUrl: (m.avatar_url as string) ?? null,
        emailAddress: (m.email_address as string) ?? null,
        accessLevel: (m.access_level as string) ?? null,
        createdAt: (m.created_at as string) ?? null,
      }
    })
    return {
      success: true,
      output: {
        members,
        count: members.length,
      },
    }
  },

  outputs: {
    members: {
      type: 'array',
      description: 'Array of workspace members',
      items: {
        type: 'object',
        properties: MEMBER_OUTPUT_PROPERTIES,
      },
    },
    count: { type: 'number', description: 'Number of members returned' },
  },
}
