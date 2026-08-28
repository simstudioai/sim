import type { CbInsightsOrgParams } from '@/tools/cbinsights/types'
import { createInternalToolOperationInput } from '@/tools/operation-input'
import type { InternalToolConfig, ToolResponse } from '@/tools/types'

export interface CbInsightsOrgFundingsParams extends CbInsightsOrgParams {
  limit?: number | string
  nextPageToken?: string
}

export const cbinsightsGetOrgFundingsTool: InternalToolConfig<
  CbInsightsOrgFundingsParams,
  ToolResponse
> = {
  id: 'cbinsights_get_org_fundings',
  name: 'CB Insights Get Organization Fundings',
  description:
    'Retrieve the funding rounds one organization has received, its cap table history, and AI-generated insights extracting the key themes of each deal.',
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
    limit: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Rows to return in a single response, 1-100',
    },
    nextPageToken: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Continuation token from a previous response; omit for the first page',
    },
  },

  operation: {
    input: createInternalToolOperationInput,
  },

  outputs: {
    fundings: {
      type: 'json',
      description:
        'Rounds as [{dealId, date, round, roundCategory, amountInMillions, valuationInMillions, investors, insights, sources}]',
    },
    capTableHistory: {
      type: 'json',
      description:
        'Ownership structure as [{dealId, roundType, issuancePrice, conversionPrice, percentageOwned, sharesAuthorized, terms}]',
    },
    nextPageToken: {
      type: 'string',
      nullable: true,
      description: 'Token for the next page, or null when there are no more results',
    },
    totalHits: {
      type: 'number',
      nullable: true,
      description: 'Total number of matching records',
    },
    totalHitsRelation: {
      type: 'string',
      nullable: true,
      description: "Whether totalHits is exact ('eq') or a floor ('gte', used above 10,000)",
    },
  },
}
