import {
  RB2B_MAID_RESULT_OUTPUT_PROPERTIES,
  type Rb2bIdentifierParams,
  type Rb2bMaidResponse,
} from '@/tools/rb2b/types'
import { buildIdentifierBody, RB2B_API_BASE, rb2bHeaders } from '@/tools/rb2b/utils'
import type { ToolConfig } from '@/tools/types'

export const rb2bHemToMaidTool: ToolConfig<Rb2bIdentifierParams, Rb2bMaidResponse> = {
  id: 'rb2b_hem_to_maid',
  name: 'RB2B Email/HEM to MAID',
  description:
    'Return up to five mobile advertising identifiers (MAIDs) associated with an email address or MD5-hashed email.',
  version: '1.0.0',

  params: {
    apiKey: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'RB2B API key',
    },
    email: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'A plaintext email address or an MD5 hash of the email',
    },
  },

  request: {
    method: 'POST',
    url: `${RB2B_API_BASE}/hem_to_maid`,
    headers: (params) => rb2bHeaders(params.apiKey),
    body: (params) => buildIdentifierBody(params.email),
  },

  transformResponse: async (response: Response) => {
    const data = await response.json()
    return {
      success: true,
      output: {
        results: data.results ?? [],
      },
    }
  },

  outputs: {
    results: {
      type: 'array',
      description: 'Mobile advertising identifiers associated with the email',
      items: { type: 'object', properties: RB2B_MAID_RESULT_OUTPUT_PROPERTIES },
    },
  },
}
