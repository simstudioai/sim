import type { InternalToolConfig } from '@/tools/types'
import { VANTA_CONTROL_DETAIL_OUTPUT_PROPERTIES } from '@/tools/vanta/outputs'
import type { VantaGetControlParams, VantaGetControlResponse } from '@/tools/vanta/types'
import { createVantaTransformResponse } from '@/tools/vanta/utils'

export const vantaGetControlTool: InternalToolConfig<
  VantaGetControlParams,
  VantaGetControlResponse
> = {
  id: 'vanta_get_control',
  name: 'Vanta Get Control',
  description:
    'Get a Vanta security control by ID, including its status and evidence pass/fail counts',
  version: '1.0.0',

  oauth: { required: true, provider: 'vanta', authoritativeParams: ['apiDomain'] },

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
    controlId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Unique ID of the control',
    },
  },

  operation: {
    input: (params) => ({
      operation: 'vanta_get_control',
      accessToken: params.accessToken,
      apiDomain: params.apiDomain,
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
