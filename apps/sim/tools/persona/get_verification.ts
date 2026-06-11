import type {
  PersonaGetVerificationParams,
  PersonaVerificationResponse,
} from '@/tools/persona/types'
import {
  asResource,
  buildPersonaHeaders,
  mapVerification,
  PERSONA_API_BASE,
  parsePersonaResponse,
  VERIFICATION_OUTPUT_PROPERTIES,
} from '@/tools/persona/utils'
import type { ToolConfig } from '@/tools/types'

export const personaGetVerificationTool: ToolConfig<
  PersonaGetVerificationParams,
  PersonaVerificationResponse
> = {
  id: 'persona_get_verification',
  name: 'Persona Get Verification',
  description:
    'Retrieve a single verification by ID (government ID, selfie, document, database, and more), including its status and the checks that ran.',
  version: '1.0.0',

  params: {
    apiKey: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'Persona API key',
    },
    verificationId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Verification ID to retrieve (starts with ver_)',
    },
  },

  request: {
    url: (params) =>
      `${PERSONA_API_BASE}/verifications/${encodeURIComponent(params.verificationId.trim())}`,
    method: 'GET',
    headers: (params) => buildPersonaHeaders(params.apiKey),
  },

  transformResponse: async (response) => {
    const data = await parsePersonaResponse(response)
    return {
      success: true,
      output: {
        verification: mapVerification(asResource(data.data)),
      },
    }
  },

  outputs: {
    verification: {
      type: 'object',
      description: 'The retrieved verification',
      properties: VERIFICATION_OUTPUT_PROPERTIES,
    },
  },
}
