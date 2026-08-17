import type {
  MicrosoftAdListDirectoryAuditsParams,
  MicrosoftAdListDirectoryAuditsResponse,
} from '@/tools/microsoft_ad/types'
import { DIRECTORY_AUDIT_OUTPUT_PROPERTIES } from '@/tools/microsoft_ad/types'
import {
  assertGraphNextPageUrlForCollection,
  buildGraphCollectionUrl,
} from '@/tools/microsoft_ad/utils'
import { getGraphNextPageUrl } from '@/tools/sharepoint/utils'
import type { ToolConfig } from '@/tools/types'

export const listDirectoryAuditsTool: ToolConfig<
  MicrosoftAdListDirectoryAuditsParams,
  MicrosoftAdListDirectoryAuditsResponse
> = {
  id: 'microsoft_ad_list_directory_audits',
  name: 'List Microsoft Entra ID Directory Audits',
  description:
    'List directory audit records showing who changed what in Microsoft Entra ID, such as user creation, group membership changes, and role assignments',
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
      description: 'Maximum number of audit records to return',
    },
    filter: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        'OData filter expression. Filterable fields include activityDateTime, activityDisplayName, correlationId, loggedByService, initiatedBy and targetResources. Example: "activityDateTime ge 2024-01-01T00:00:00Z".',
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
        return assertGraphNextPageUrlForCollection(params.nextLink, ['directoryAudits'])
      return buildGraphCollectionUrl('auditLogs/directoryAudits', {
        top: params.top,
        filter: params.filter,
        orderby: 'activityDateTime desc',
      })
    },
    method: 'GET',
    headers: (params) => ({
      Authorization: `Bearer ${params.accessToken}`,
    }),
  },
  transformResponse: async (response: Response) => {
    const data = await response.json()
    const audits = (data.value ?? []).map((audit: Record<string, unknown>) => {
      const initiatedBy = (audit.initiatedBy ?? null) as Record<string, unknown> | null
      const initiatingUser = (initiatedBy?.user ?? null) as Record<string, unknown> | null
      const initiatingApp = (initiatedBy?.app ?? null) as Record<string, unknown> | null
      const targetResources = Array.isArray(audit.targetResources) ? audit.targetResources : []
      return {
        id: audit.id ?? null,
        activityDateTime: audit.activityDateTime ?? null,
        activityDisplayName: audit.activityDisplayName ?? null,
        category: audit.category ?? null,
        correlationId: audit.correlationId ?? null,
        loggedByService: audit.loggedByService ?? null,
        operationType: audit.operationType ?? null,
        result: audit.result ?? null,
        resultReason: audit.resultReason ?? null,
        initiatedByUserId: initiatingUser?.id ?? null,
        initiatedByUserPrincipalName: initiatingUser?.userPrincipalName ?? null,
        initiatedByUserDisplayName: initiatingUser?.displayName ?? null,
        initiatedByAppId: initiatingApp?.appId ?? null,
        initiatedByAppDisplayName: initiatingApp?.displayName ?? null,
        targetResources: targetResources.map((target: Record<string, unknown>) => ({
          id: target.id ?? null,
          displayName: target.displayName ?? null,
          type: target.type ?? null,
          userPrincipalName: target.userPrincipalName ?? null,
        })),
      }
    })
    return {
      success: true,
      output: {
        audits,
        auditCount: audits.length,
        nextLink: getGraphNextPageUrl(data) ?? null,
      },
    }
  },
  outputs: {
    audits: {
      type: 'array',
      description: 'Directory audit records',
      items: {
        type: 'object',
        properties: DIRECTORY_AUDIT_OUTPUT_PROPERTIES,
      },
    },
    auditCount: { type: 'number', description: 'Number of audit records returned' },
    nextLink: {
      type: 'string',
      description: 'Continuation URL for the next page of results, or null if there are no more',
      optional: true,
    },
  },
}
