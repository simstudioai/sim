import { createLogger } from '@sim/logger'
import type { ListDomainsParams, ListDomainsResult } from '@/tools/resend/types'
import type { ToolConfig } from '@/tools/types'

const logger = createLogger('ResendListDomainsTool')

export const resendListDomainsTool: ToolConfig<ListDomainsParams, ListDomainsResult> = {
  id: 'resend_list_domains',
  name: 'List Domains',
  description: 'List all verified domains in your Resend account',
  version: '1.0.0',

  params: {
    resendApiKey: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'Resend API key',
    },
  },

  request: {
    url: 'https://api.resend.com/domains',
    method: 'GET',
    headers: (params: ListDomainsParams) => ({
      Authorization: `Bearer ${params.resendApiKey}`,
      'Content-Type': 'application/json',
    }),
  },

  transformResponse: async (response: Response): Promise<ListDomainsResult> => {
    const data = await response.json()

    if (data.message) {
      logger.error('Resend List Domains API error:', JSON.stringify(data, null, 2))
      return {
        success: false,
        error: data.message || 'Failed to list domains',
        output: {
          domains: [],
          hasMore: false,
        },
      }
    }

    return {
      success: true,
      output: {
        domains: (data.data ?? []).map(
          (domain: {
            id: string
            name: string
            status: string
            region: string
            created_at: string
          }) => ({
            id: domain.id,
            name: domain.name,
            status: domain.status,
            region: domain.region,
            createdAt: domain.created_at,
          })
        ),
        hasMore: data.has_more ?? false,
      },
    }
  },

  outputs: {
    domains: {
      type: 'json',
      description: 'Array of domains with id, name, status, region, and createdAt',
    },
    hasMore: { type: 'boolean', description: 'Whether there are more domains to retrieve' },
  },
}
