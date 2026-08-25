import {
  extractGoogleApiError,
  type GoogleAnalyticsAccount,
  type GoogleAnalyticsListAccountsParams,
  type GoogleAnalyticsListAccountsResponse,
  toBooleanParam,
  toOptionalNumberParam,
} from '@/tools/google_analytics/types'
import type { ToolConfig } from '@/tools/types'

export const googleAnalyticsListAccountsTool: ToolConfig<
  GoogleAnalyticsListAccountsParams,
  GoogleAnalyticsListAccountsResponse
> = {
  id: 'google_analytics_list_accounts',
  name: 'List Google Analytics Accounts',
  description: 'List all Google Analytics accounts accessible by the authenticated user',
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
      description: 'Accounts per page (default 50, max 200)',
    },
    pageToken: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Page token from a previous response',
    },
    showDeleted: {
      type: 'boolean',
      required: false,
      visibility: 'user-or-llm',
      description: 'Include soft-deleted accounts',
    },
  },

  request: {
    url: (params) => {
      const query = new URLSearchParams()
      const pageSize = toOptionalNumberParam(params.pageSize)
      if (pageSize !== undefined) query.set('pageSize', String(pageSize))
      if (params.pageToken) query.set('pageToken', params.pageToken)
      const showDeleted = toBooleanParam(params.showDeleted)
      if (showDeleted !== undefined) query.set('showDeleted', String(showDeleted))
      const suffix = query.toString()
      return `https://analyticsadmin.googleapis.com/v1beta/accounts${suffix ? `?${suffix}` : ''}`
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
        output: { accounts: [], totalCount: 0, nextPageToken: null },
        error: extractGoogleApiError(data),
      }
    }

    const accounts: GoogleAnalyticsAccount[] = (data.accounts ?? []).map(
      (account: Record<string, unknown>) => ({
        name: (account.name as string) ?? '',
        displayName: (account.displayName as string) ?? null,
        regionCode: (account.regionCode as string) ?? null,
        createTime: (account.createTime as string) ?? null,
        updateTime: (account.updateTime as string) ?? null,
        deleted: (account.deleted as boolean) ?? false,
        gmpOrganization: (account.gmpOrganization as string) ?? null,
      })
    )

    return {
      success: true,
      output: {
        accounts,
        totalCount: accounts.length,
        nextPageToken: data.nextPageToken ?? null,
      },
    }
  },

  outputs: {
    accounts: {
      type: 'array',
      description: 'Accessible Google Analytics accounts',
      items: {
        type: 'json',
        description: 'Account',
        properties: {
          name: { type: 'string', description: 'Resource name (accounts/{id})' },
          displayName: { type: 'string', description: 'Account display name', nullable: true },
          regionCode: {
            type: 'string',
            description: 'Country code of the business',
            nullable: true,
          },
          createTime: { type: 'string', description: 'Creation timestamp', nullable: true },
          updateTime: { type: 'string', description: 'Last update timestamp', nullable: true },
          deleted: { type: 'boolean', description: 'Whether the account is soft-deleted' },
          gmpOrganization: {
            type: 'string',
            description: 'Linked Google Marketing Platform organization',
            nullable: true,
          },
        },
      },
    },
    totalCount: {
      type: 'number',
      description: 'Number of accounts returned on this page',
    },
    nextPageToken: {
      type: 'string',
      description: 'Token for the next page of accounts',
      nullable: true,
    },
  },
}
