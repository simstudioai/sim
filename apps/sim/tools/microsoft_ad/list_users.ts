import type {
  MicrosoftAdListUsersParams,
  MicrosoftAdListUsersResponse,
} from '@/tools/microsoft_ad/types'
import { USER_OUTPUT_PROPERTIES } from '@/tools/microsoft_ad/types'
import { assertGraphNextPageUrl, getGraphNextPageUrl } from '@/tools/sharepoint/utils'
import type { ToolConfig } from '@/tools/types'

export const listUsersTool: ToolConfig<MicrosoftAdListUsersParams, MicrosoftAdListUsersResponse> = {
  id: 'microsoft_ad_list_users',
  name: 'List Azure AD Users',
  description: 'List users in Azure AD (Microsoft Entra ID)',
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
    top: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Maximum number of users to return (default 100, max 999)',
    },
    filter: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'OData filter expression (e.g., "department eq \'Sales\'")',
    },
    search: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Search string to filter users by displayName or mail',
    },
    nextLink: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Continuation URL from a previous response\'s "nextLink" output, used to fetch the next page of results',
    },
  },
  request: {
    url: (params) => {
      if (params.nextLink) return assertGraphNextPageUrl(params.nextLink)
      const queryParts: string[] = []
      queryParts.push(
        '$select=id,displayName,givenName,surname,userPrincipalName,mail,jobTitle,department,officeLocation,mobilePhone,accountEnabled'
      )
      if (params.top) queryParts.push(`$top=${params.top}`)
      if (params.filter) queryParts.push(`$filter=${encodeURIComponent(params.filter)}`)
      if (params.search) {
        const term = params.search.replace(/\\/g, '\\\\').replace(/"/g, '\\"')
        queryParts.push(`$search=${encodeURIComponent(`"displayName:${term}" OR "mail:${term}"`)}`)
        queryParts.push('$count=true')
      }
      return `https://graph.microsoft.com/v1.0/users?${queryParts.join('&')}`
    },
    method: 'GET',
    headers: (params) => ({
      Authorization: `Bearer ${params.accessToken}`,
      ConsistencyLevel: 'eventual',
    }),
  },
  transformResponse: async (response: Response) => {
    const data = await response.json()
    const users = (data.value ?? []).map((user: Record<string, unknown>) => ({
      id: user.id ?? null,
      displayName: user.displayName ?? null,
      givenName: user.givenName ?? null,
      surname: user.surname ?? null,
      userPrincipalName: user.userPrincipalName ?? null,
      mail: user.mail ?? null,
      jobTitle: user.jobTitle ?? null,
      department: user.department ?? null,
      officeLocation: user.officeLocation ?? null,
      mobilePhone: user.mobilePhone ?? null,
      accountEnabled: user.accountEnabled ?? null,
    }))
    return {
      success: true,
      output: {
        users,
        userCount: users.length,
        nextLink: getGraphNextPageUrl(data) ?? null,
      },
    }
  },
  outputs: {
    users: {
      type: 'array',
      description: 'List of users',
      properties: USER_OUTPUT_PROPERTIES,
    },
    userCount: { type: 'number', description: 'Number of users returned' },
    nextLink: {
      type: 'string',
      description: 'Continuation URL for the next page of results, or null if there are no more',
      optional: true,
    },
  },
}
