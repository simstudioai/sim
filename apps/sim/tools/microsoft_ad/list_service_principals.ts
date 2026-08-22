import type {
  MicrosoftAdListServicePrincipalsParams,
  MicrosoftAdListServicePrincipalsResponse,
} from '@/tools/microsoft_ad/types'
import {
  APP_ROLE_OUTPUT_PROPERTIES,
  SERVICE_PRINCIPAL_OUTPUT_PROPERTIES,
} from '@/tools/microsoft_ad/types'
import {
  assertGraphNextPageUrlForCollection,
  buildGraphCollectionUrl,
  graphCollectionHeaders,
  usesGraphAdvancedQuery,
} from '@/tools/microsoft_ad/utils'
import { getGraphNextPageUrl } from '@/tools/sharepoint/utils'
import type { ToolConfig } from '@/tools/types'

const SERVICE_PRINCIPAL_SELECT =
  'id,appId,displayName,servicePrincipalType,accountEnabled,appOwnerOrganizationId,signInAudience,tags,appRoles'

export const listServicePrincipalsTool: ToolConfig<
  MicrosoftAdListServicePrincipalsParams,
  MicrosoftAdListServicePrincipalsResponse
> = {
  id: 'microsoft_ad_list_service_principals',
  name: 'List Microsoft Entra ID Service Principals',
  description:
    'List the enterprise applications and service principals in the tenant, including the app roles each one exposes',
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
      description:
        'Maximum number of service principals to return (default and maximum page size is 100)',
    },
    filter: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: `OData filter expression. Example: "servicePrincipalType eq 'Application'" or "startsWith(displayName, 'Salesforce')".`,
    },
    search: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Search string matched against the service principal display name',
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
        return assertGraphNextPageUrlForCollection(params.nextLink, ['servicePrincipals'])
      const search = params.search?.trim()
      return buildGraphCollectionUrl('servicePrincipals', {
        select: SERVICE_PRINCIPAL_SELECT,
        top: params.top,
        filter: params.filter,
        search: search
          ? `"displayName:${search.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`
          : undefined,
        count: usesGraphAdvancedQuery(params),
      })
    },
    method: 'GET',
    headers: (params) => graphCollectionHeaders(params),
  },
  transformResponse: async (response: Response) => {
    const data = await response.json()
    const servicePrincipals = (data.value ?? []).map(
      (servicePrincipal: Record<string, unknown>) => ({
        id: servicePrincipal.id ?? null,
        appId: servicePrincipal.appId ?? null,
        displayName: servicePrincipal.displayName ?? null,
        servicePrincipalType: servicePrincipal.servicePrincipalType ?? null,
        accountEnabled: servicePrincipal.accountEnabled ?? null,
        appOwnerOrganizationId: servicePrincipal.appOwnerOrganizationId ?? null,
        signInAudience: servicePrincipal.signInAudience ?? null,
        tags: servicePrincipal.tags ?? [],
        appRoles: (Array.isArray(servicePrincipal.appRoles) ? servicePrincipal.appRoles : []).map(
          (appRole: Record<string, unknown>) => ({
            id: appRole.id ?? null,
            displayName: appRole.displayName ?? null,
            description: appRole.description ?? null,
            value: appRole.value ?? null,
            isEnabled: appRole.isEnabled ?? null,
            allowedMemberTypes: appRole.allowedMemberTypes ?? [],
          })
        ),
      })
    )
    return {
      success: true,
      output: {
        servicePrincipals,
        servicePrincipalCount: servicePrincipals.length,
        nextLink: getGraphNextPageUrl(data) ?? null,
      },
    }
  },
  outputs: {
    servicePrincipals: {
      type: 'array',
      description: 'Service principals in the tenant',
      items: {
        type: 'object',
        properties: {
          ...SERVICE_PRINCIPAL_OUTPUT_PROPERTIES,
          appRoles: {
            type: 'array',
            description: 'App roles exposed by the associated application',
            items: {
              type: 'object',
              properties: APP_ROLE_OUTPUT_PROPERTIES,
            },
          },
        },
      },
    },
    servicePrincipalCount: {
      type: 'number',
      description: 'Number of service principals returned',
    },
    nextLink: {
      type: 'string',
      description: 'Continuation URL for the next page of results, or null if there are no more',
      optional: true,
    },
  },
}
