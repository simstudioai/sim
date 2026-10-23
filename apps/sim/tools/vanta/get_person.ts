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
        accessToken: params.accessToken,
        apiDomain: params.apiDomain,
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
