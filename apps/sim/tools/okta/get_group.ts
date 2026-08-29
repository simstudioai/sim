import { createLogger } from '@sim/logger'
import { validateOktaDomain } from '@/lib/core/security/input-validation'
import type { OktaGetGroupParams, OktaGetGroupResponse, OktaGroup } from '@/tools/okta/types'
import { oktaHeaders, throwOktaError } from '@/tools/okta/utils'
import type { ToolConfig } from '@/tools/types'
import { safeUrlPathSegment } from '@/tools/url-path'

const logger = createLogger('OktaGetGroup')

export const oktaGetGroupTool: ToolConfig<OktaGetGroupParams, OktaGetGroupResponse> = {
  id: 'okta_get_group',
  name: 'Get Group from Okta',
  description: 'Get a specific group by ID from your Okta organization',
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
      description: 'Group ID to look up',
    },
  },

  request: {
    url: (params) => {
      const domain = validateOktaDomain(params.domain)
      return `https://${domain}/api/v1/groups/${safeUrlPathSegment(params.groupId, 'groupId')}`
    },
    method: 'GET',
    headers: (params) => oktaHeaders(params.apiKey),
  },

  transformResponse: async (response: Response) => {
    if (!response.ok) {
      await throwOktaError(response, logger, 'Failed to get group from Okta')
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
    id: { type: 'string', description: 'Group ID' },
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
