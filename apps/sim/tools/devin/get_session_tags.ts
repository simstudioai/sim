import type { ToolConfig } from '@/tools/types'
import type { DevinGetSessionTagsParams, DevinSessionTagsResponse } from './types'

export const devinGetSessionTagsTool: ToolConfig<
  DevinGetSessionTagsParams,
  DevinSessionTagsResponse
> = {
  id: 'devin_get_session_tags',
  name: 'get_session_tags',
  description: 'Retrieve the tags currently applied to a Devin session.',
  version: '1.0.0',

  params: {
    apiKey: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'Devin API key (service user credential starting with cog_)',
    },
    orgId: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'Devin organization ID (prefixed with org-)',
    },
    sessionId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'The session ID to retrieve tags for',
    },
  },

  request: {
    url: (params) =>
      `https://api.devin.ai/v3/organizations/${params.orgId.trim()}/sessions/${params.sessionId.trim()}/tags`,
    method: 'GET',
    headers: (params) => ({
      Authorization: `Bearer ${params.apiKey}`,
    }),
  },

  transformResponse: async (response: Response) => {
    const data = await response.json()
    return {
      success: true,
      output: {
        tags: data.tags ?? [],
      },
    }
  },

  outputs: {
    tags: {
      type: 'json',
      description: 'Tags applied to the session (array of strings)',
    },
  },
}
