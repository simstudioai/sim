import type {
  ApolloOrganizationEnrichParams,
  ApolloOrganizationEnrichResponse,
} from '@/tools/apollo/types'
import type { ToolConfig } from '@/tools/types'

export const apolloOrganizationEnrichTool: ToolConfig<
  ApolloOrganizationEnrichParams,
  ApolloOrganizationEnrichResponse
> = {
  id: 'apollo_organization_enrich',
  name: 'Apollo Organization Enrichment',
  description: 'Enrich data for a single organization using Apollo',
  version: '1.0.0',

  params: {
    apiKey: {
      type: 'string',
      required: true,
      visibility: 'hidden',
      description: 'Apollo API key',
    },
    domain: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Company domain (e.g., "apollo.io", "acme.com")',
    },
  },

  request: {
    url: 'https://api.apollo.io/api/v1/organizations/enrich',
    method: 'POST',
    headers: (params: ApolloOrganizationEnrichParams) => ({
      'Content-Type': 'application/json',
      'Cache-Control': 'no-cache',
      'X-Api-Key': params.apiKey,
    }),
    body: (params: ApolloOrganizationEnrichParams) => {
      const domain = params.domain?.trim()
      if (!domain) {
        throw new Error('domain is required for organization enrichment')
      }
      return { domain }
    },
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
        organization: data.organization ?? null,
        enriched: !!data.organization,
      },
    }
  },

  outputs: {
    organization: {
      type: 'json',
      description: 'Enriched organization data from Apollo',
      optional: true,
    },
    enriched: {
      type: 'boolean',
      description: 'Whether the organization was successfully enriched',
    },
  },
}
