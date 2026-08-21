import type { CbInsightsOrgParams } from '@/tools/cbinsights/types'
import {
  asArray,
  cbInsightsRequest,
  clampLimit,
  compactBody,
  pageInfo,
  requireOrgId,
} from '@/tools/cbinsights/utils'
import type { ToolConfig, ToolResponse } from '@/tools/types'

interface CbInsightsOrgInvestmentsParams extends CbInsightsOrgParams {
  limit?: number | string
  nextPageToken?: string
}

export const cbinsightsGetOrgInvestmentsTool: ToolConfig<
  CbInsightsOrgInvestmentsParams,
  ToolResponse
> = {
  id: 'cbinsights_get_org_investments',
  name: 'CB Insights Get Organization Investments',
  description:
    'Retrieve the rounds in which one organization invested in another, with AI-generated insights extracting the key themes of each deal.',
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

  request: { url: () => '', method: 'POST', headers: () => ({}) },

  directExecution: async (params, signal) => {
    const orgId = requireOrgId(params.orgId)
    return cbInsightsRequest<{
      investments?: unknown
      nextPageToken?: unknown
      totalHits?: unknown
      totalHitsRelation?: unknown
    }>(
      params,
      {
        path: `/v2/organizations/${orgId}/financialtransactions/investments`,
        body: compactBody({
          limit: clampLimit(params.limit),
          nextPageToken: params.nextPageToken?.trim(),
        }),
      },
      (data) => ({ investments: asArray(data.investments), ...pageInfo(data) }),
      signal
    )
  },

  outputs: {
    investments: {
      type: 'json',
      description:
        'Rounds as [{dealId, date, round, roundCategory, amountInMillions, valuationInMillions, recipient, investors, insights, sources}]',
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
