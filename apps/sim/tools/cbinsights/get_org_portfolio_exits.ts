import type { CbInsightsOrgParams } from '@/tools/cbinsights/types'
import { asArray, cbInsightsRequest, requireOrgId } from '@/tools/cbinsights/utils'
import type { ToolConfig, ToolResponse } from '@/tools/types'

export const cbinsightsGetOrgPortfolioExitsTool: ToolConfig<CbInsightsOrgParams, ToolResponse> = {
  id: 'cbinsights_get_org_portfolio_exits',
  name: 'CB Insights Get Organization Portfolio Exits',
  description:
    'Retrieve exit rounds for companies this organization invested in before the exit, with AI-generated insights on each deal.',
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

  request: { url: () => '', method: 'POST', headers: () => ({}) },

  directExecution: async (params, signal) => {
    const orgId = requireOrgId(params.orgId)
    return cbInsightsRequest<{ portfolioExits?: unknown }>(
      params,
      { path: `/v2/organizations/${orgId}/financialtransactions/portfolioexits` },
      (data) => ({ portfolioExits: asArray(data.portfolioExits) }),
      signal
    )
  },

  outputs: {
    portfolioExits: {
      type: 'json',
      description:
        'Exits as [{dealId, date, round, roundCategory, amountInMillions, valuationInMillions, recipient, investors, insights, sources}]',
    },
  },
}
