import type { CbInsightsOrgListParams, CbInsightsOrgListResponse } from '@/tools/cbinsights/types'
import { createInternalToolOperationInput } from '@/tools/operation-input'
import type { InternalToolConfig } from '@/tools/types'

export interface CbInsightsListOutlookParams extends CbInsightsOrgListParams {}

export const cbinsightsListOutlookTool: InternalToolConfig<
  CbInsightsListOutlookParams,
  CbInsightsOrgListResponse
> = {
  id: 'cbinsights_list_outlook',
  name: 'CB Insights List Outlook',
  description:
    'Retrieve Mosaic Score, Commercial Maturity, and Exit Probability for up to 100 organizations at once.',
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
  },

  operation: {
    input: createInternalToolOperationInput,
  },

  outputs: {
    orgs: {
      type: 'json',
      description:
        'Organizations as [{orgId, mosaicScore, commercialMaturity, exitProbability}]. An organization with no data is omitted from the response.',
    },
  },
}
