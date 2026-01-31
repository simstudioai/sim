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
    organization_name: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Name of the organization (e.g., "Acme Corporation") - at least one of organization_name or domain is required',
    },
    domain: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Company domain (e.g., "apollo.io", "acme.com") - at least one of domain or organization_name is required',
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
      // At least one identifier is required
      if (!params.organization_name && !params.domain) {
        throw new Error(
          'At least one of organization_name or domain is required for organization enrichment'
        )
      }

      const body: any = {}
      if (params.organization_name) body.name = params.organization_name
      if (params.domain) body.domain = params.domain
      return body
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
        organization: data.organization || {},
        enriched: !!data.organization,
      },
    }
  },

  outputs: {
    organization: { type: 'json', description: 'Enriched organization data from Apollo' },
    enriched: {
      type: 'boolean',
      description: 'Whether the organization was successfully enriched',
    },
  },
}
