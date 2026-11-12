import type {
  MicrosoftAdListUserMembershipsParams,
  MicrosoftAdListUserMembershipsResponse,
} from '@/tools/microsoft_ad/types'
import { MEMBERSHIP_OUTPUT_PROPERTIES } from '@/tools/microsoft_ad/types'
import { isTrueFlag } from '@/tools/microsoft_ad/utils'
import { assertGraphNextPageUrlForCollection, getGraphNextPageUrl } from '@/tools/sharepoint/utils'
import type { ToolConfig } from '@/tools/types'
import { safeUrlPathSegment } from '@/tools/url-path'

const MEMBERSHIP_SELECT =
  'id,displayName,description,mail,mailEnabled,securityEnabled,groupTypes,roleTemplateId'

export const listUserMembershipsTool: ToolConfig<
  MicrosoftAdListUserMembershipsParams,
  MicrosoftAdListUserMembershipsResponse
> = {
  id: 'microsoft_ad_list_user_memberships',
  name: 'List Azure AD User Memberships',
  description:
    'List the groups, directory roles, and administrative units a user is a member of in Azure AD (Microsoft Entra ID)',
  version: '1.0.0',
  errorExtractor: 'nested-error-object',
  oauth: {
    required: true,
    provider: 'microsoft-ad',
  },
  params: {
    accessToken: {
      type: 'string',
      required: true,
      visibility: 'hidden',
      description: 'Microsoft Graph API access token',
    },
    userId: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'User ID or user principal name. Required unless continuing from a nextLink.',
    },
    transitive: {
      type: 'boolean',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Include memberships inherited through nested groups (transitiveMemberOf). Defaults to direct memberships only.',
    },
    top: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Maximum number of memberships to return per page (default 100, max 999)',
    },
    nextLink: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        "Continuation URL from a previous response's 'nextLink' output, used to fetch the next page of results",
    },
  },
  request: {
    url: (params) => {
      const relationship = isTrueFlag(params.transitive) ? 'transitiveMemberOf' : 'memberOf'
      if (params.nextLink)
        return assertGraphNextPageUrlForCollection(params.nextLink, [
          'memberOf',
          'transitiveMemberOf',
        ])
      const userId = params.userId?.trim()
      if (!userId) throw new Error('User ID is required')
      const queryParts = [`$select=${MEMBERSHIP_SELECT}`]
      if (params.top) queryParts.push(`$top=${params.top}`)
      return `https://graph.microsoft.com/v1.0/users/${safeUrlPathSegment(userId, 'userId')}/${relationship}?${queryParts.join('&')}`
    },
    method: 'GET',
    headers: (params) => ({
      Authorization: `Bearer ${params.accessToken}`,
    }),
  },
  transformResponse: async (response: Response) => {
    const data = await response.json()
    const memberships = (data.value ?? []).map((entry: Record<string, unknown>) => ({
      id: entry.id ?? null,
      displayName: entry.displayName ?? null,
      description: entry.description ?? null,
      odataType: entry['@odata.type'] ?? null,
      mail: entry.mail ?? null,
      mailEnabled: entry.mailEnabled ?? null,
      securityEnabled: entry.securityEnabled ?? null,
      groupTypes: Array.isArray(entry.groupTypes) ? entry.groupTypes : [],
      roleTemplateId: entry.roleTemplateId ?? null,
    }))
    return {
      success: true,
      output: {
        memberships,
        membershipCount: memberships.length,
        nextLink: getGraphNextPageUrl(data) ?? null,
      },
    }
  },
  outputs: {
    memberships: {
      type: 'array',
      description: 'Groups, directory roles, and administrative units the user belongs to',
      items: {
        type: 'object',
        properties: MEMBERSHIP_OUTPUT_PROPERTIES,
      },
    },
    membershipCount: { type: 'number', description: 'Number of memberships returned' },
    nextLink: {
      type: 'string',
      description: 'Continuation URL for the next page of results, or null if there are no more',
      optional: true,
    },
  },
}
