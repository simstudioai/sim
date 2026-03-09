import type { ListDomainsParams, ListDomainsResult } from '@/tools/mailgun/types'
import type { ToolConfig } from '@/tools/types'

export const mailgunListDomainsTool: ToolConfig<ListDomainsParams, ListDomainsResult> = {
  id: 'mailgun_list_domains',
  name: 'Mailgun List Domains',
  description: 'List all domains for your Mailgun account',
  version: '1.0.0',

  params: {
    apiKey: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'Mailgun API key',
    },
  },

  request: {
    url: () => 'https://api.mailgun.net/v3/domains',
    method: 'GET',
    headers: (params) => ({
      Authorization: `Basic ${Buffer.from(`api:${params.apiKey}`).toString('base64')}`,
    }),
  },

  transformResponse: async (response, params): Promise<ListDomainsResult> => {
    if (!response.ok) {
      const error = await response.json()
      throw new Error(error.message || 'Failed to list domains')
    }

    const result = await response.json()

    return {
      success: true,
      output: {
        success: true,
        totalCount: result.total_count,
        items: result.items || [],
      },
    }
  },

  outputs: {
    success: { type: 'boolean', description: 'Whether the request was successful' },
    totalCount: { type: 'number', description: 'Total number of domains' },
    items: { type: 'json', description: 'Array of domain objects' },
  },
}
