import type { ToolConfig } from '@/tools/types'
import { VANTA_CONTROL_DETAIL_OUTPUT_PROPERTIES } from '@/tools/vanta/outputs'
import type { VantaGetControlParams, VantaGetControlResponse } from '@/tools/vanta/types'
import { createVantaTransformResponse, VANTA_QUERY_ROUTE } from '@/tools/vanta/utils'

export const vantaGetControlTool: ToolConfig<VantaGetControlParams, VantaGetControlResponse> = {
  id: 'vanta_get_control',
  name: 'Vanta Get Control',
  description:
    'Get a Vanta security control by ID, including its status and evidence pass/fail counts',
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
    controlId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Unique ID of the control',
    },
  },

  request: {
    url: VANTA_QUERY_ROUTE,
    method: 'POST',
    headers: () => ({ 'Content-Type': 'application/json' }),
    body: (params) => ({
      operation: 'vanta_get_control',
      clientId: params.clientId,
      clientSecret: params.clientSecret,
      region: params.region,
      controlId: params.controlId,
    }),
  },

  transformResponse: createVantaTransformResponse<VantaGetControlResponse>(
    'Failed to get Vanta control'
  ),

  outputs: {
    control: {
      type: 'json',
      description: 'The requested control with status and evidence counts',
      properties: VANTA_CONTROL_DETAIL_OUTPUT_PROPERTIES,
    },
  },
}
