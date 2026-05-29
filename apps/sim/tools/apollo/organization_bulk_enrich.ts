import type {
  ApolloOrganizationBulkEnrichParams,
  ApolloOrganizationBulkEnrichResponse,
} from '@/tools/apollo/types'
import type { ToolConfig } from '@/tools/types'

export const apolloOrganizationBulkEnrichTool: ToolConfig<
  ApolloOrganizationBulkEnrichParams,
  ApolloOrganizationBulkEnrichResponse
> = {
  id: 'apollo_organization_bulk_enrich',
  name: 'Apollo Bulk Organization Enrichment',
  description: 'Enrich data for up to 10 organizations at once using Apollo',
  version: '1.0.0',

  params: {
    apiKey: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'Apollo API key',
    },
    domains: {
      type: 'array',
      required: true,
      visibility: 'user-or-llm',
      description:
        'Array of company domains to enrich (max 10, no www. or @, e.g., ["apollo.io", "stripe.com"])',
    },
  },

  request: {
    url: (params: ApolloOrganizationBulkEnrichParams) => {
      const qs = new URLSearchParams()
      for (const domain of params.domains.slice(0, 10)) {
        const trimmed = typeof domain === 'string' ? domain.trim() : ''
        if (trimmed) qs.append('domains[]', trimmed)
      }
      return `https://api.apollo.io/api/v1/organizations/bulk_enrich?${qs.toString()}`
    },
    method: 'POST',
    headers: (params: ApolloOrganizationBulkEnrichParams) => ({
      'Cache-Control': 'no-cache',
      'X-Api-Key': params.apiKey,
    }),
  },

  transformResponse: async (response: Response) => {
    if (!response.ok) {
      const errorText = await response.text()
      throw new Error(`Apollo API error: ${response.status} - ${errorText}`)
    }

    const data = await response.json()
    const organizations = data.organizations ?? []

    return {
      success: true,
      output: {
        organizations,
        total: data.total_requested_domains ?? organizations.length,
        enriched: data.unique_enriched_records ?? organizations.length,
        missing_records: data.missing_records ?? 0,
        unique_domains: data.unique_domains ?? organizations.length,
      },
    }
  },

  outputs: {
    organizations: { type: 'json', description: 'Array of enriched organization data' },
    total: { type: 'number', description: 'Total number of domains requested' },
    enriched: { type: 'number', description: 'Number of unique enriched records' },
    missing_records: {
      type: 'number',
      description: 'Number of domains that could not be enriched',
    },
    unique_domains: { type: 'number', description: 'Number of unique domains processed' },
  },
}
