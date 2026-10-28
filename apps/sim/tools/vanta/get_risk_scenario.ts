import type { InternalToolConfig } from '@/tools/types'
import { VANTA_RISK_SCENARIO_OUTPUT_PROPERTIES } from '@/tools/vanta/outputs'
import type { VantaGetRiskScenarioParams, VantaGetRiskScenarioResponse } from '@/tools/vanta/types'
import { createVantaTransformResponse } from '@/tools/vanta/utils'

export const vantaGetRiskScenarioTool: InternalToolConfig<
  VantaGetRiskScenarioParams,
  VantaGetRiskScenarioResponse
> = {
  id: 'vanta_get_risk_scenario',
  name: 'Vanta Get Risk Scenario',
  description:
    'Get a Vanta risk scenario by ID, including its scores, treatment decision, and review status',
  version: '1.0.0',

  oauth: {
    required: true,
    provider: 'vanta',
    credentialKind: 'service-account',
    authoritativeParams: ['apiDomain'],
    retryOnUnauthorized: true,
  },

  params: {
    accessToken: {
      type: 'string',
      required: true,
      visibility: 'hidden',
      description: 'Access token supplied by the saved Vanta credential',
    },
    apiDomain: {
      type: 'string',
      required: true,
      visibility: 'hidden',
      description: 'API origin supplied by the saved Vanta credential',
    },
    riskScenarioId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Unique ID of the risk scenario',
    },
  },

  operation: {
    input: (params) => ({
      operation: 'vanta_get_risk_scenario',
      accessToken: params.accessToken,
      apiDomain: params.apiDomain,
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
