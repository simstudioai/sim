import type {
  MicrosoftAdListGroupsParams,
  MicrosoftAdListGroupsResponse,
} from '@/tools/microsoft_ad/types'
import { GROUP_OUTPUT_PROPERTIES } from '@/tools/microsoft_ad/types'
import { assertGraphNextPageUrl, getGraphNextPageUrl } from '@/tools/sharepoint/utils'
import type { ToolConfig } from '@/tools/types'

export const listGroupsTool: ToolConfig<
  MicrosoftAdListGroupsParams,
  MicrosoftAdListGroupsResponse
> = {
  id: 'microsoft_ad_list_groups',
  name: 'List Azure AD Groups',
  description: 'List groups in Azure AD (Microsoft Entra ID)',
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
      description: 'Maximum number of groups to return (default 100, max 999)',
    },
    filter: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'OData filter expression (e.g., "securityEnabled eq true")',
    },
    search: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Search string to filter groups by displayName or description',
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
        '$select=id,displayName,description,mail,mailEnabled,mailNickname,securityEnabled,groupTypes,visibility,createdDateTime'
      )
      if (params.top) queryParts.push(`$top=${params.top}`)
      if (params.filter) queryParts.push(`$filter=${encodeURIComponent(params.filter)}`)
      if (params.search) {
        const term = params.search.replace(/\\/g, '\\\\').replace(/"/g, '\\"')
        queryParts.push(
          `$search=${encodeURIComponent(`"displayName:${term}" OR "description:${term}"`)}`
        )
        queryParts.push('$count=true')
      }
      return `https://graph.microsoft.com/v1.0/groups?${queryParts.join('&')}`
    },
    method: 'GET',
    headers: (params) => ({
      Authorization: `Bearer ${params.accessToken}`,
      ConsistencyLevel: 'eventual',
    }),
  },
  transformResponse: async (response: Response) => {
    const data = await response.json()
    const groups = (data.value ?? []).map((group: Record<string, unknown>) => ({
      id: group.id ?? null,
      displayName: group.displayName ?? null,
      description: group.description ?? null,
      mail: group.mail ?? null,
      mailEnabled: group.mailEnabled ?? null,
      mailNickname: group.mailNickname ?? null,
      securityEnabled: group.securityEnabled ?? null,
      groupTypes: group.groupTypes ?? [],
      visibility: group.visibility ?? null,
      createdDateTime: group.createdDateTime ?? null,
    }))
    return {
      success: true,
      output: {
        groups,
        groupCount: groups.length,
        nextLink: getGraphNextPageUrl(data) ?? null,
      },
    }
  },
  outputs: {
    groups: {
      type: 'array',
      description: 'List of groups',
      properties: GROUP_OUTPUT_PROPERTIES,
    },
    groupCount: { type: 'number', description: 'Number of groups returned' },
    nextLink: {
      type: 'string',
      description: 'Continuation URL for the next page of results, or null if there are no more',
      optional: true,
    },
  },
}
