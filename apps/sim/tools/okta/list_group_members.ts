import { createLogger } from '@sim/logger'
import { validateOktaDomain } from '@/lib/core/security/input-validation'
import type {
  OktaApiError,
  OktaListGroupMembersParams,
  OktaListGroupMembersResponse,
  OktaUser,
} from '@/tools/okta/types'
import type { ToolConfig } from '@/tools/types'

const logger = createLogger('OktaListGroupMembers')

export const oktaListGroupMembersTool: ToolConfig<
  OktaListGroupMembersParams,
  OktaListGroupMembersResponse
> = {
  id: 'okta_list_group_members',
  name: 'List Group Members from Okta',
  description: 'List all members of a specific group in your Okta organization',
  version: '1.0.0',

  params: {
    apiKey: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'Okta API token for authentication',
    },
    domain: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'Okta domain (e.g., dev-123456.okta.com)',
    },
    groupId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Group ID to list members for',
    },
    limit: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Maximum number of members to return (default: 1000, max: 1000)',
    },
  },

  request: {
    url: (params) => {
      const domain = validateOktaDomain(params.domain)
      const queryParams = new URLSearchParams()

      if (params.limit) queryParams.append('limit', params.limit.toString())

      const queryString = queryParams.toString()
      const base = `https://${domain}/api/v1/groups/${encodeURIComponent(params.groupId)}/users`
      return queryString ? `${base}?${queryString}` : base
    },
    method: 'GET',
    headers: (params) => ({
      Authorization: `SSWS ${params.apiKey}`,
      Accept: 'application/json',
      'Content-Type': 'application/json',
    }),
  },

  transformResponse: async (response: Response) => {
    if (!response.ok) {
      let error: OktaApiError = {}
      try {
        error = await response.json()
      } catch {
        // non-JSON error body
      }
      logger.error('Okta API request failed', { data: error, status: response.status })
      throw new Error(error.errorSummary || 'Failed to list group members from Okta')
    }

    const data: OktaUser[] = await response.json()

    const members = data.map((user) => ({
      id: user.id,
      status: user.status,
      firstName: user.profile?.firstName ?? null,
      lastName: user.profile?.lastName ?? null,
      email: user.profile?.email ?? null,
      login: user.profile?.login ?? null,
      mobilePhone: user.profile?.mobilePhone ?? null,
      title: user.profile?.title ?? null,
      department: user.profile?.department ?? null,
      created: user.created,
      lastLogin: user.lastLogin ?? null,
      lastUpdated: user.lastUpdated,
      activated: user.activated ?? null,
      statusChanged: user.statusChanged ?? null,
    }))

    return {
      success: true,
      output: {
        members,
        count: members.length,
        success: true,
      },
    }
  },

  outputs: {
    members: {
      type: 'array',
      description: 'Array of group member user objects',
      items: {
        type: 'object',
        properties: {
          id: { type: 'string', description: 'User ID' },
          status: { type: 'string', description: 'User status' },
          firstName: { type: 'string', description: 'First name', optional: true },
          lastName: { type: 'string', description: 'Last name', optional: true },
          email: { type: 'string', description: 'Email address', optional: true },
          login: { type: 'string', description: 'Login', optional: true },
          mobilePhone: { type: 'string', description: 'Mobile phone', optional: true },
          title: { type: 'string', description: 'Job title', optional: true },
          department: { type: 'string', description: 'Department', optional: true },
          created: { type: 'string', description: 'Creation timestamp' },
          lastLogin: { type: 'string', description: 'Last login timestamp', optional: true },
          lastUpdated: { type: 'string', description: 'Last update timestamp' },
          activated: { type: 'string', description: 'Activation timestamp', optional: true },
          statusChanged: {
            type: 'string',
            description: 'Status change timestamp',
            optional: true,
          },
        },
      },
    },
    count: { type: 'number', description: 'Number of members returned' },
    success: { type: 'boolean', description: 'Operation success status' },
  },
}
