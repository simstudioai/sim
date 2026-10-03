import { createLogger } from '@sim/logger'
import { validateOktaDomain } from '@/lib/core/security/input-validation'
import type { OktaCreateGroupParams, OktaCreateGroupResponse, OktaGroup } from '@/tools/okta/types'
import { oktaHeaders, throwOktaError } from '@/tools/okta/utils'
import type { ToolConfig } from '@/tools/types'

const logger = createLogger('OktaCreateGroup')

export const oktaCreateGroupTool: ToolConfig<OktaCreateGroupParams, OktaCreateGroupResponse> = {
  id: 'okta_create_group',
  name: 'Create Group in Okta',
  description: 'Create a new group in your Okta organization',
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
    name: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Name of the group',
    },
    description: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Description of the group',
    },
  },

  request: {
    url: (params) => {
      const domain = validateOktaDomain(params.domain)
      return `https://${domain}/api/v1/groups`
    },
    method: 'POST',
    headers: (params) => oktaHeaders(params.apiKey),
    body: (params) => {
      const profile: Record<string, string> = { name: params.name }
      if (params.description) profile.description = params.description
      return { profile }
    },
  },

  transformResponse: async (response: Response) => {
    if (!response.ok) {
      await throwOktaError(response, logger, 'Failed to create group in Okta')
    }

    const group: OktaGroup = await response.json()
    return {
      success: true,
      output: {
        id: group.id,
        name: group.profile?.name ?? '',
        description: group.profile?.description ?? null,
        type: group.type,
        created: group.created,
        lastUpdated: group.lastUpdated,
        lastMembershipUpdated: group.lastMembershipUpdated ?? null,
        success: true,
      },
    }
  },

  outputs: {
    id: { type: 'string', description: 'Created group ID' },
    name: { type: 'string', description: 'Group name' },
    description: { type: 'string', description: 'Group description', optional: true },
    type: { type: 'string', description: 'Group type' },
    created: { type: 'string', description: 'Creation timestamp' },
    lastUpdated: { type: 'string', description: 'Last update timestamp' },
    lastMembershipUpdated: {
      type: 'string',
      description: 'Last membership change timestamp',
      optional: true,
    },
    success: { type: 'boolean', description: 'Operation success status' },
  },
}
