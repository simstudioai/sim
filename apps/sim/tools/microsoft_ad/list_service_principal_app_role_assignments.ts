import type {
  MicrosoftAdListAppRoleAssignmentsResponse,
  MicrosoftAdListServicePrincipalAppRoleAssignmentsParams,
} from '@/tools/microsoft_ad/types'
import { APP_ROLE_ASSIGNMENT_OUTPUT_PROPERTIES } from '@/tools/microsoft_ad/types'
import { assertGraphNextPageUrlForCollection } from '@/tools/microsoft_ad/utils'
import { getGraphNextPageUrl } from '@/tools/sharepoint/utils'
import type { ToolConfig } from '@/tools/types'

export const listServicePrincipalAppRoleAssignmentsTool: ToolConfig<
  MicrosoftAdListServicePrincipalAppRoleAssignmentsParams,
  MicrosoftAdListAppRoleAssignmentsResponse
> = {
  id: 'microsoft_ad_list_service_principal_app_role_assignments',
  name: 'List Microsoft Entra ID Application Assignments',
  description:
    'List every user, group, and service principal assigned to an application, by reading the app role assignments on its service principal. Recently granted or removed assignments can take time to appear.',
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
    servicePrincipalId: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Object ID of the service principal. Use List Service Principals to find it. Not needed when Next Page is provided to fetch a later page.',
    },
    filter: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: `OData filter expression supporting eq and startswith. Example: "principalType eq 'User'".`,
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
        return assertGraphNextPageUrlForCollection(params.nextLink, ['appRoleAssignedTo'])
      const servicePrincipalId = params.servicePrincipalId?.trim()
      if (!servicePrincipalId) throw new Error('Service principal ID is required')
      const base = `https://graph.microsoft.com/v1.0/servicePrincipals/${encodeURIComponent(servicePrincipalId)}/appRoleAssignedTo`
      return params.filter ? `${base}?$filter=${encodeURIComponent(params.filter)}` : base
    },
    method: 'GET',
    headers: (params) => ({
      Authorization: `Bearer ${params.accessToken}`,
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
      description: 'Principals assigned to the application',
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
