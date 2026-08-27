import type { CbInsightsListResponse, CbInsightsOrgListParams } from '@/tools/cbinsights/types'
import {
  asArray,
  cbInsightsRequest,
  clampLimit,
  compactBody,
  pageInfo,
  requireOrgIds,
} from '@/tools/cbinsights/utils'
import type { ToolConfig } from '@/tools/types'

interface CbInsightsListPortfolioExitsParams extends CbInsightsOrgListParams {
  limit?: number | string
  nextPageToken?: string
}

export const cbinsightsListPortfolioExitsTool: ToolConfig<
  CbInsightsListPortfolioExitsParams,
  CbInsightsListResponse
> = {
  id: 'cbinsights_list_portfolio_exits',
  name: 'CB Insights List Portfolio Exits',
  description:
    'Retrieve exit rounds for companies up to 100 organizations invested in before the exit, with AI-generated insights on each deal.',
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

  request: { url: () => '', method: 'POST', headers: () => ({}) },

  directExecution: async (params, signal) =>
    cbInsightsRequest<{
      orgs?: unknown
      nextPageToken?: unknown
      totalHits?: unknown
      totalHitsRelation?: unknown
    }>(
      params,
      {
        path: '/v2/financialtransactions/portfolioexits',
        body: compactBody({
          orgIds: requireOrgIds(params.orgIds),
          limit: clampLimit(params.limit),
          nextPageToken: params.nextPageToken?.trim(),
        }),
      },
      (data) => ({ orgs: asArray(data.orgs), ...pageInfo(data) }),
      signal
    ),

  outputs: {
    orgs: {
      type: 'json',
      description:
        'Organizations as [{orgId, portfolioExits}]. An organization with no data is omitted from the response.',
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
