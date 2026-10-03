import type { CbInsightsOrgParams } from '@/tools/cbinsights/types'
import { createInternalToolOperationInput } from '@/tools/operation-input'
import type { InternalToolConfig, ToolResponse } from '@/tools/types'

export const cbinsightsGetStrategyMapTool: InternalToolConfig<CbInsightsOrgParams, ToolResponse> = {
  id: 'cbinsights_get_strategy_map',
  name: 'CB Insights Get Strategy Map',
  description:
    'Retrieve the companies related to an organization, grouped into industry categories, with the relationships, investments, and acquisitions that connect them.',
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
    orgName: {
      type: 'string',
      nullable: true,
      description: "The organization's name",
    },
    logoUrl: {
      type: 'string',
      nullable: true,
      description: "URL of the organization's logo",
    },
    categories: {
      type: 'json',
      description:
        'Industry categories as [{name, companies: [{orgId, name, logoUrl, connections: {businessRelationships, investments, acquisitions}}]}]',
    },
  },
}
