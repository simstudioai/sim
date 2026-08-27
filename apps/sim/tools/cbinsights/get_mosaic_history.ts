import type { CbInsightsOrgParams } from '@/tools/cbinsights/types'
import { asArray, cbInsightsRequest, compactBody, requireOrgId } from '@/tools/cbinsights/utils'
import type { ToolConfig, ToolResponse } from '@/tools/types'

interface CbInsightsMosaicHistoryParams extends CbInsightsOrgParams {
  startDate?: string
}

export const cbinsightsGetMosaicHistoryTool: ToolConfig<
  CbInsightsMosaicHistoryParams,
  ToolResponse
> = {
  id: 'cbinsights_get_mosaic_history',
  name: 'CB Insights Get Mosaic History',
  description:
    "Retrieve an organization's historical Mosaic Scores — overall plus the management, market, momentum, and money factors — so a trend can be read rather than a single snapshot.",
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
    startDate: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Earliest date to return, as YYYY-MM-DD. Must be on or after 2024-01-01 and within the last 24 months. Defaults to the later of one year ago and 2024-01-01.',
    },
  },

  request: { url: () => '', method: 'POST', headers: () => ({}) },

  directExecution: async (params, signal) => {
    const orgId = requireOrgId(params.orgId)
    return cbInsightsRequest<{
      overall?: unknown
      management?: unknown
      market?: unknown
      momentum?: unknown
      money?: unknown
    }>(
      params,
      {
        path: `/v2/organizations/${orgId}/mosaichistory`,
        body: compactBody({ startDate: params.startDate?.trim() }),
      },
      (data) => ({
        overall: asArray(data.overall),
        management: asArray(data.management),
        market: asArray(data.market),
        momentum: asArray(data.momentum),
        money: asArray(data.money),
      }),
      signal
    )
  },

  outputs: {
    overall: {
      type: 'json',
      description: 'Overall Mosaic Score over time as [{asOfDate, scoreValue}]',
    },
    management: {
      type: 'json',
      description: 'Management factor over time as [{asOfDate, scoreValue}]',
    },
    market: {
      type: 'json',
      description: 'Market factor over time as [{asOfDate, scoreValue}]',
    },
    momentum: {
      type: 'json',
      description: 'Momentum factor over time as [{asOfDate, scoreValue}]',
    },
    money: {
      type: 'json',
      description: 'Money factor over time as [{asOfDate, scoreValue}]',
    },
  },
}
