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
      visibility: 'hidden',
      description: 'Apollo API key',
    },
    organizations: {
      type: 'array',
      required: true,
      visibility: 'user-or-llm',
      description: 'Array of organizations to enrich (max 10)',
    },
  },

  request: {
    url: 'https://api.apollo.io/api/v1/organizations/bulk_enrich',
    method: 'POST',
    headers: (params: ApolloOrganizationBulkEnrichParams) => ({
      'Content-Type': 'application/json',
      'Cache-Control': 'no-cache',
      'X-Api-Key': params.apiKey,
    }),
    body: (params: ApolloOrganizationBulkEnrichParams) => ({
      details: params.organizations.slice(0, 10),
    }),
  },

  transformResponse: async (response: Response) => {
    if (!response.ok) {
      const errorText = await response.text()
      throw new Error(`Apollo API error: ${response.status} - ${errorText}`)
    }

    const data = await response.json()

    return {
      success: true,
      output: {
        organizations: data.matches || [],
        metadata: {
          total: data.matches?.length || 0,
          enriched: data.matches?.filter((o: any) => o).length || 0,
        },
      },
    }
  },

  outputs: {
    organizations: { type: 'json', description: 'Array of enriched organization data' },
    metadata: {
      type: 'json',
      description: 'Bulk enrichment metadata including total and enriched counts',
    },
  },
}
