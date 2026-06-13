import type { ToolConfig } from '@/tools/types'
import { VANTA_RISK_SCENARIO_OUTPUT_PROPERTIES } from '@/tools/vanta/outputs'
import type { VantaGetRiskScenarioParams, VantaGetRiskScenarioResponse } from '@/tools/vanta/types'
import { createVantaTransformResponse, VANTA_QUERY_ROUTE } from '@/tools/vanta/utils'

export const vantaGetRiskScenarioTool: ToolConfig<
  VantaGetRiskScenarioParams,
  VantaGetRiskScenarioResponse
> = {
  id: 'vanta_get_risk_scenario',
  name: 'Vanta Get Risk Scenario',
  description:
    'Get a Vanta risk scenario by ID, including its scores, treatment decision, and review status',
  version: '1.0.0',

  params: {
    clientId: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'Vanta OAuth application client ID',
    },
    clientSecret: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'Vanta OAuth application client secret',
    },
    region: {
      type: 'string',
      required: false,
      visibility: 'user-only',
      description: 'Vanta API region: "us" (api.vanta.com, default) or "gov" (api.vanta-gov.com)',
    },
    riskScenarioId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Unique ID of the risk scenario',
    },
  },

  request: {
    url: VANTA_QUERY_ROUTE,
    method: 'POST',
    headers: () => ({ 'Content-Type': 'application/json' }),
    body: (params) => ({
      operation: 'vanta_get_risk_scenario',
      clientId: params.clientId,
      clientSecret: params.clientSecret,
      region: params.region,
      riskScenarioId: params.riskScenarioId,
    }),
  },

  transformResponse: createVantaTransformResponse<VantaGetRiskScenarioResponse>(
    'Failed to get Vanta risk scenario'
  ),

  outputs: {
    riskScenario: {
      type: 'json',
      description: 'The requested risk scenario',
      properties: VANTA_RISK_SCENARIO_OUTPUT_PROPERTIES,
    },
  },
}
