import type { ToolConfig } from '@/tools/types'
import type { ProfoundCitationPromptsParams, ProfoundCitationPromptsResponse } from './types'

export const profoundCitationPromptsTool: ToolConfig<
  ProfoundCitationPromptsParams,
  ProfoundCitationPromptsResponse
> = {
  id: 'profound_citation_prompts',
  name: 'Profound Citation Prompts',
  description: 'Get prompts that cite a specific domain across AI platforms in Profound',
  version: '1.0.0',

  params: {
    apiKey: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'Profound API Key',
    },
    inputDomain: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Domain to look up citations for (e.g. ramp.com)',
    },
  },

  request: {
    url: (params) => {
      const url = new URL('https://api.tryprofound.com/v1/prompt-volumes/citation-prompts')
      url.searchParams.set('input_domain', params.inputDomain)
      return url.toString()
    },
    method: 'GET',
    headers: (params) => ({
      'X-API-Key': params.apiKey,
      Accept: 'application/json',
    }),
  },

  transformResponse: async (response) => {
    const data = await response.json()
    if (!response.ok) {
      throw new Error(data.detail?.[0]?.msg || 'Failed to get citation prompts')
    }
    return {
      success: true,
      output: {
        data: data ?? null,
      },
    }
  },

  outputs: {
    data: {
      type: 'json',
      description: 'Citation prompt data for the queried domain',
    },
  },
}
