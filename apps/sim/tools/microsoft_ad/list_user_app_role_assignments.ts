import type {
  MicrosoftAdListAppRoleAssignmentsResponse,
  MicrosoftAdListUserAppRoleAssignmentsParams,
} from '@/tools/microsoft_ad/types'
import { APP_ROLE_ASSIGNMENT_OUTPUT_PROPERTIES } from '@/tools/microsoft_ad/types'
import { assertGraphNextPageUrlForCollection } from '@/tools/microsoft_ad/utils'
import { getGraphNextPageUrl } from '@/tools/sharepoint/utils'
import type { ToolConfig } from '@/tools/types'

export const listUserAppRoleAssignmentsTool: ToolConfig<
  MicrosoftAdListUserAppRoleAssignmentsParams,
  MicrosoftAdListAppRoleAssignmentsResponse
> = {
  id: 'microsoft_ad_list_user_app_role_assignments',
  name: 'List Microsoft Entra ID User App Role Assignments',
  description:
    'List the application role assignments granted to a user, including assignments the user inherits from groups they are a direct member of',
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
      description:
        'User ID or user principal name. Not needed when Next Page is provided to fetch a later page.',
    },
    top: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Maximum number of assignments to return',
    },
    filter: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        'OData filter expression. Filterable fields include id, resourceId and principalDisplayName. Example: "resourceId eq 8e881353-1735-45af-af21-ee1344582a4d".',
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
      if (params.nextLink)
        return assertGraphNextPageUrlForCollection(params.nextLink, ['appRoleAssignments'])
      const userId = params.userId?.trim()
      if (!userId) throw new Error('User ID is required')
      const queryParts = ['$count=true']
      if (params.top) queryParts.push(`$top=${params.top}`)
      if (params.filter) queryParts.push(`$filter=${encodeURIComponent(params.filter)}`)
      return `https://graph.microsoft.com/v1.0/users/${encodeURIComponent(userId)}/appRoleAssignments?${queryParts.join('&')}`
    },
    method: 'GET',
    headers: (params) => ({
      Authorization: `Bearer ${params.accessToken}`,
      ConsistencyLevel: 'eventual',
    }),
  },
  transformResponse: async (response: Response) => {
    const data = await response.json()
    const assignments = (data.value ?? []).map((assignment: Record<string, unknown>) => ({
      id: assignment.id ?? null,
      appRoleId: assignment.appRoleId ?? null,
      createdDateTime: assignment.createdDateTime ?? null,
      principalId: assignment.principalId ?? null,
      principalDisplayName: assignment.principalDisplayName ?? null,
      principalType: assignment.principalType ?? null,
      resourceId: assignment.resourceId ?? null,
      resourceDisplayName: assignment.resourceDisplayName ?? null,
    }))
    return {
      success: true,
      output: {
        assignments,
        assignmentCount: assignments.length,
        nextLink: getGraphNextPageUrl(data) ?? null,
      },
    }
  },
  outputs: {
    assignments: {
      type: 'array',
      description: 'App role assignments granted to the user',
      items: {
        type: 'object',
        properties: APP_ROLE_ASSIGNMENT_OUTPUT_PROPERTIES,
      },
    },
    assignmentCount: { type: 'number', description: 'Number of assignments returned' },
    nextLink: {
      type: 'string',
      description: 'Continuation URL for the next page of results, or null if there are no more',
      optional: true,
    },
  },
}
