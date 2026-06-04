import type { ToolConfig } from '@/tools/types'
import type { DevinReplaceSessionTagsParams, DevinSessionTagsResponse } from './types'
import { normalizeTags } from './utils'

export const devinReplaceSessionTagsTool: ToolConfig<
  DevinReplaceSessionTagsParams,
  DevinSessionTagsResponse
> = {
  id: 'devin_replace_session_tags',
  name: 'replace_session_tags',
  description: 'Replace all tags on a Devin session with a new set of tags (max 50 tags).',
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
      description: 'The session ID to replace tags on',
    },
    tags: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description:
        'Tags that will overwrite the existing tags (comma-separated string or array of strings)',
    },
  },

  request: {
    url: (params) =>
      `https://api.devin.ai/v3/organizations/${params.orgId.trim()}/sessions/${params.sessionId.trim()}/tags`,
    method: 'PUT',
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
