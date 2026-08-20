import type { CbInsightsOrgParams } from '@/tools/cbinsights/types'
import {
  asArray,
  asNumber,
  asString,
  cbInsightsRequest,
  requireOrgId,
} from '@/tools/cbinsights/utils'
import type { ToolConfig, ToolResponse } from '@/tools/types'

export const cbinsightsGetOrgRevenueTool: ToolConfig<CbInsightsOrgParams, ToolResponse> = {
  id: 'cbinsights_get_org_revenue',
  name: 'CB Insights Get Organization Revenue',
  description:
    'Retrieve reported and estimated revenue by calendar year for one organization, with the sources behind each figure.',
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
    return cbInsightsRequest<{
      orgId?: unknown
      orgName?: unknown
      orgUrl?: unknown
      revenue?: unknown
    }>(
      params,
      { path: `/v2/organizations/${orgId}/revenuebyyear` },
      (data) => ({
        orgId: asNumber(data.orgId),
        orgName: asString(data.orgName),
        orgUrl: asString(data.orgUrl),
        revenue: asArray(data.revenue),
      }),
      signal
    )
  },

  outputs: {
    orgId: {
      type: 'number',
      nullable: true,
      description: 'CB Insights organization ID',
    },
    orgName: {
      type: 'string',
      nullable: true,
      description: "The organization's name",
    },
    orgUrl: {
      type: 'string',
      nullable: true,
      description: "The organization's website",
    },
    revenue: {
      type: 'json',
      description:
        'Revenue by year as [{calendarYear, lowestValue, averageValue, highestValue, isActual, reportedMetric, yoyGrowthPercent, sources}]',
    },
  },
}
