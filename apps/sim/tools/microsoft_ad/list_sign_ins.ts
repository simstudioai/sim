import type {
  MicrosoftAdListSignInsParams,
  MicrosoftAdListSignInsResponse,
} from '@/tools/microsoft_ad/types'
import { SIGN_IN_OUTPUT_PROPERTIES } from '@/tools/microsoft_ad/types'
import {
  assertGraphNextPageUrlForCollection,
  buildGraphCollectionUrl,
} from '@/tools/microsoft_ad/utils'
import { getGraphNextPageUrl } from '@/tools/sharepoint/utils'
import type { ToolConfig } from '@/tools/types'

export const listSignInsTool: ToolConfig<
  MicrosoftAdListSignInsParams,
  MicrosoftAdListSignInsResponse
> = {
  id: 'microsoft_ad_list_sign_ins',
  name: 'List Microsoft Entra ID Sign-Ins',
  description:
    'List sign-in events from the Microsoft Entra ID sign-in logs, newest first. Requires a Microsoft Entra ID P1 or P2 license. Apply a date filter to keep large queries from timing out.',
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
      description: 'Maximum number of sign-ins to return (default and maximum page size is 1000)',
    },
    filter: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        'OData filter expression. Filterable fields include userPrincipalName, userId, appId, appDisplayName, ipAddress, createdDateTime, conditionalAccessStatus, riskState and status/errorCode. Example: "createdDateTime ge 2024-01-01T00:00:00Z and status/errorCode ne 0".',
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
      if (params.nextLink) return assertGraphNextPageUrlForCollection(params.nextLink, ['signIns'])
      return buildGraphCollectionUrl('auditLogs/signIns', {
        top: params.top,
        filter: params.filter,
      })
    },
    method: 'GET',
    headers: (params) => ({
      Authorization: `Bearer ${params.accessToken}`,
    }),
  },
  transformResponse: async (response: Response) => {
    const data = await response.json()
    const signIns = (data.value ?? []).map((signIn: Record<string, unknown>) => {
      const status = (signIn.status ?? null) as Record<string, unknown> | null
      const deviceDetail = (signIn.deviceDetail ?? null) as Record<string, unknown> | null
      const location = (signIn.location ?? null) as Record<string, unknown> | null
      return {
        id: signIn.id ?? null,
        createdDateTime: signIn.createdDateTime ?? null,
        userId: signIn.userId ?? null,
        userDisplayName: signIn.userDisplayName ?? null,
        userPrincipalName: signIn.userPrincipalName ?? null,
        appId: signIn.appId ?? null,
        appDisplayName: signIn.appDisplayName ?? null,
        resourceId: signIn.resourceId ?? null,
        resourceDisplayName: signIn.resourceDisplayName ?? null,
        ipAddress: signIn.ipAddress ?? null,
        clientAppUsed: signIn.clientAppUsed ?? null,
        correlationId: signIn.correlationId ?? null,
        conditionalAccessStatus: signIn.conditionalAccessStatus ?? null,
        isInteractive: signIn.isInteractive ?? null,
        riskDetail: signIn.riskDetail ?? null,
        riskLevelAggregated: signIn.riskLevelAggregated ?? null,
        riskState: signIn.riskState ?? null,
        errorCode: status?.errorCode ?? null,
        failureReason: status?.failureReason ?? null,
        deviceDisplayName: deviceDetail?.displayName ?? null,
        deviceId: deviceDetail?.deviceId ?? null,
        deviceOperatingSystem: deviceDetail?.operatingSystem ?? null,
        deviceBrowser: deviceDetail?.browser ?? null,
        deviceIsCompliant: deviceDetail?.isCompliant ?? null,
        deviceIsManaged: deviceDetail?.isManaged ?? null,
        locationCity: location?.city ?? null,
        locationState: location?.state ?? null,
        locationCountryOrRegion: location?.countryOrRegion ?? null,
      }
    })
    return {
      success: true,
      output: {
        signIns,
        signInCount: signIns.length,
        nextLink: getGraphNextPageUrl(data) ?? null,
      },
    }
  },
  outputs: {
    signIns: {
      type: 'array',
      description: 'Sign-in events',
      items: {
        type: 'object',
        properties: SIGN_IN_OUTPUT_PROPERTIES,
      },
    },
    signInCount: { type: 'number', description: 'Number of sign-ins returned' },
    nextLink: {
      type: 'string',
      description: 'Continuation URL for the next page of results, or null if there are no more',
      optional: true,
    },
  },
}
