import type { CbInsightsOrgListParams, CbInsightsOrgListResponse } from '@/tools/cbinsights/types'
import { asArray, cbInsightsRequest, compactBody, requireOrgIds } from '@/tools/cbinsights/utils'
import type { ToolConfig } from '@/tools/types'

interface CbInsightsListFundingWindowParams extends CbInsightsOrgListParams {}

export const cbinsightsListFundingWindowTool: ToolConfig<
  CbInsightsListFundingWindowParams,
  CbInsightsOrgListResponse
> = {
  id: 'cbinsights_list_funding_window',
  name: 'CB Insights List Funding Windows',
  description:
    'Retrieve the estimated next-round funding window for up to 100 organizations at once, with the cohort each was compared against.',
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

  request: { url: () => '', method: 'POST', headers: () => ({}) },

  directExecution: async (params, signal) =>
    cbInsightsRequest<{ orgs?: unknown }>(
      params,
      {
        path: '/v2/outlook/fundingwindow',
        body: compactBody({
          orgIds: requireOrgIds(params.orgIds),
        }),
      },
      (data) => ({ orgs: asArray(data.orgs) }),
      signal
    ),

  outputs: {
    orgs: {
      type: 'json',
      description:
        'Organizations as [{orgId, windowStart, windowEnd, cohortNextRoundRate, cohortCriteria, latestFunding}]. An organization with no data is omitted from the response.',
    },
  },
}
