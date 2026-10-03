import type { CbInsightsOrgParams } from '@/tools/cbinsights/types'
import { createInternalToolOperationInput } from '@/tools/operation-input'
import type { InternalToolConfig, ToolResponse } from '@/tools/types'

export const cbinsightsGetOrgBusinessRelationshipsTool: InternalToolConfig<
  CbInsightsOrgParams,
  ToolResponse
> = {
  id: 'cbinsights_get_org_business_relationships',
  name: 'CB Insights Get Organization Business Relationships',
  description:
    "Retrieve one organization's partnerships, client/vendor relationships, and licensing activity, with AI-generated insights on each.",
  version: '1.0.0',

  params: {
    clientId: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'CB Insights API client ID, exchanged for a bearer token before each call',
    },
    clientSecret: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'CB Insights API client secret, exchanged for a bearer token before each call',
    },
    orgId: {
      type: 'number',
      required: true,
      visibility: 'user-or-llm',
      description:
        'CB Insights organization ID. Resolve a name or website to one with Look Up Organizations, which never charges credits.',
    },
  },

  operation: {
    input: createInternalToolOperationInput,
  },

  outputs: {
    businessRelationships: {
      type: 'json',
      description:
        'Relationships as [{relationshipId, startDate, partners, insights, newsSnippet, sources, lastUpdateTime}]',
    },
  },
}
