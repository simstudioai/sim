import type { InternalToolConfig } from '@/tools/types'
import { VANTA_PERSON_OUTPUT_PROPERTIES } from '@/tools/vanta/outputs'
import type { VantaGetPersonParams, VantaGetPersonResponse } from '@/tools/vanta/types'
import { createVantaTransformResponse } from '@/tools/vanta/utils'

export const vantaGetPersonTool: InternalToolConfig<VantaGetPersonParams, VantaGetPersonResponse> =
  {
    id: 'vanta_get_person',
    name: 'Vanta Get Person',
    description:
      'Get a person tracked in Vanta by ID, including employment, leave, and security task status',
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
      personId: {
        type: 'string',
        required: true,
        visibility: 'user-or-llm',
        description: 'Unique ID of the person',
      },
    },

    operation: {
      input: (params) => ({
        operation: 'vanta_get_person',
        clientId: params.clientId,
        clientSecret: params.clientSecret,
        region: params.region,
        personId: params.personId,
      }),
    },

    transformResponse: createVantaTransformResponse<VantaGetPersonResponse>(
      'Failed to get Vanta person'
    ),

    outputs: {
      person: {
        type: 'json',
        description: 'The requested person',
        properties: VANTA_PERSON_OUTPUT_PROPERTIES,
      },
    },
  }
