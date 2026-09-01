import type { CbInsightsListResponse, CbInsightsOrgListParams } from '@/tools/cbinsights/types'
import { createInternalToolOperationInput } from '@/tools/operation-input'
import type { InternalToolConfig } from '@/tools/types'

export interface CbInsightsListInvestmentsParams extends CbInsightsOrgListParams {
  limit?: number | string
  nextPageToken?: string
}

export const cbinsightsListInvestmentsTool: InternalToolConfig<
  CbInsightsListInvestmentsParams,
  CbInsightsListResponse
> = {
  id: 'cbinsights_list_investments',
  name: 'CB Insights List Investments',
  description:
    'Retrieve the rounds up to 100 organizations participated in as investors, with AI-generated insights extracting the key themes of each deal.',
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
    orgIds: {
      type: 'json',
      required: true,
      visibility: 'user-or-llm',
      description: 'CB Insights organization IDs, 1-100 per request, e.g. [129410, 1034157]',
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
    orgs: {
      type: 'json',
      description:
        'Organizations as [{orgId, investments}]. An organization with no data is omitted from the response.',
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
