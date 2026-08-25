import {
  extractGoogleApiError,
  type GoogleAnalyticsAccountSummary,
  type GoogleAnalyticsListAccountSummariesParams,
  type GoogleAnalyticsListAccountSummariesResponse,
  type GoogleAnalyticsPropertySummary,
  toOptionalNumberParam,
} from '@/tools/google_analytics/types'
import type { ToolConfig } from '@/tools/types'

export const googleAnalyticsListAccountSummariesTool: ToolConfig<
  GoogleAnalyticsListAccountSummariesParams,
  GoogleAnalyticsListAccountSummariesResponse
> = {
  id: 'google_analytics_list_account_summaries',
  name: 'List Google Analytics Account Summaries',
  description:
    'List every accessible Google Analytics account together with its properties, the fastest way to discover property IDs',
  version: '1.0.0',

  oauth: {
    required: true,
    provider: 'google-analytics',
  },

  params: {
    accessToken: {
      type: 'string',
      required: true,
      visibility: 'hidden',
      description: 'OAuth access token for the Google Analytics Admin API',
    },
    pageSize: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Account summaries per page (default 50, max 200)',
    },
    pageToken: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Page token from a previous response',
    },
  },

  request: {
    url: (params) => {
      const query = new URLSearchParams()
      const pageSize = toOptionalNumberParam(params.pageSize)
      if (pageSize !== undefined) query.set('pageSize', String(pageSize))
      if (params.pageToken) query.set('pageToken', params.pageToken)
      const suffix = query.toString()
      return `https://analyticsadmin.googleapis.com/v1beta/accountSummaries${suffix ? `?${suffix}` : ''}`
    },
    method: 'GET',
    headers: (params) => ({
      Authorization: `Bearer ${params.accessToken}`,
    }),
  },

  transformResponse: async (response: Response) => {
    const data = await response.json()

    if (!response.ok) {
      return {
        success: false,
        output: {
          accountSummaries: [],
          properties: [],
          totalCount: 0,
          nextPageToken: null,
        },
        error: extractGoogleApiError(data),
      }
    }

    const accountSummaries: GoogleAnalyticsAccountSummary[] = (data.accountSummaries ?? []).map(
      (summary: Record<string, unknown>) => ({
        name: (summary.name as string) ?? '',
        account: (summary.account as string) ?? null,
        displayName: (summary.displayName as string) ?? null,
        propertySummaries: ((summary.propertySummaries as Record<string, unknown>[]) ?? []).map(
          (property) => ({
            property: (property.property as string) ?? '',
            displayName: (property.displayName as string) ?? null,
            propertyType: (property.propertyType as string) ?? null,
            parent: (property.parent as string) ?? null,
          })
        ),
      })
    )

    const properties: GoogleAnalyticsPropertySummary[] = accountSummaries.flatMap(
      (summary) => summary.propertySummaries
    )

    return {
      success: true,
      output: {
        accountSummaries,
        properties,
        totalCount: accountSummaries.length,
        nextPageToken: data.nextPageToken ?? null,
      },
    }
  },

  outputs: {
    accountSummaries: {
      type: 'array',
      description: 'Accessible accounts with their nested property summaries',
      items: {
        type: 'json',
        description: 'Account summary',
        properties: {
          name: { type: 'string', description: 'Resource name (accountSummaries/{id})' },
          account: { type: 'string', description: 'Account resource name', nullable: true },
          displayName: { type: 'string', description: 'Account display name', nullable: true },
          propertySummaries: {
            type: 'array',
            description: 'Properties under this account',
            items: { type: 'json', description: 'Property summary' },
          },
        },
      },
    },
    properties: {
      type: 'array',
      description: 'Every property summary across all accounts, flattened',
      items: {
        type: 'json',
        description: 'Property summary',
        properties: {
          property: { type: 'string', description: 'Resource name (properties/{id})' },
          displayName: { type: 'string', description: 'Property display name', nullable: true },
          propertyType: { type: 'string', description: 'Property type', nullable: true },
          parent: { type: 'string', description: 'Parent account or property', nullable: true },
        },
      },
    },
    totalCount: {
      type: 'number',
      description: 'Number of account summaries returned on this page',
    },
    nextPageToken: {
      type: 'string',
      description: 'Token for the next page of account summaries',
      nullable: true,
    },
  },
}
