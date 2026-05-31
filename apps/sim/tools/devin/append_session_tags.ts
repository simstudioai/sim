import type { ToolConfig } from '@/tools/types'
import type { DevinAppendSessionTagsParams, DevinSessionTagsResponse } from './types'
import { normalizeTags } from './utils'

export const devinAppendSessionTagsTool: ToolConfig<
  DevinAppendSessionTagsParams,
  DevinSessionTagsResponse
> = {
  id: 'devin_append_session_tags',
  name: 'append_session_tags',
  description: 'Add tags to a Devin session without removing existing tags (max 50 tags total).',
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
      description: 'The session ID to add tags to',
    },
    tags: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Tags to append to the session (comma-separated string or array of strings)',
    },
  },

  request: {
    url: (params) =>
      `https://api.devin.ai/v3/organizations/${params.orgId.trim()}/sessions/${params.sessionId.trim()}/tags`,
    method: 'POST',
    headers: (params) => ({
      Authorization: `Bearer ${params.apiKey}`,
      'Content-Type': 'application/json',
    }),
    body: (params) => ({
      tags: normalizeTags(params.tags),
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
      description: 'Updated list of tags on the session (array of strings)',
    },
  },
}
