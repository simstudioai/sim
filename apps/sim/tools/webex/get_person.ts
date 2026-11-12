import type { ToolConfig } from '@/tools/types'
import type { WebexGetPersonParams, WebexGetPersonResponse } from '@/tools/webex/types'
import { PERSON_OUTPUT_PROPERTIES } from '@/tools/webex/types'

export const webexGetPersonTool: ToolConfig<WebexGetPersonParams, WebexGetPersonResponse> = {
  id: 'webex_get_person',
  name: 'Webex Get Person',
  description:
    'Get details of a Webex person (user) by their ID. Use "me" to get the authenticated user.',
  version: '1.0.0',

  oauth: {
    required: true,
    provider: 'webex',
    requiredScopes: ['spark:people_read'],
  },

  params: {
    accessToken: {
      type: 'string',
      required: true,
      visibility: 'hidden',
      description: 'OAuth access token for Webex API',
    },
    personId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Person ID, or "me" for the authenticated user',
    },
  },

  request: {
    url: (params) => `https://webexapis.com/v1/people/${encodeURIComponent(params.personId)}`,
    method: 'GET',
    headers: (params) => ({
      Authorization: `Bearer ${params.accessToken}`,
      'Content-Type': 'application/json',
    }),
  },

  transformResponse: async (response) => {
    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}))
      return {
        success: false,
        error:
          (errorData as { message?: string }).message ||
          `Webex API error: ${response.status} ${response.statusText}`,
        output: { person: {} },
      }
    }
    const data = await response.json()
    return { success: true, output: { person: data } }
  },

  outputs: {
    person: {
      type: 'object',
      description: 'The person object',
      properties: PERSON_OUTPUT_PROPERTIES,
    },
  },
}
