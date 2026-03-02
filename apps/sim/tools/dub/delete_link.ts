import type { DubDeleteLinkParams, DubDeleteLinkResponse } from '@/tools/dub/types'
import type { ToolConfig } from '@/tools/types'

export const deleteLinkTool: ToolConfig<DubDeleteLinkParams, DubDeleteLinkResponse> = {
  id: 'dub_delete_link',
  name: 'Dub Delete Link',
  description: 'Delete a short link by its link ID or external ID (prefixed with ext_).',
  version: '1.0.0',

  params: {
    apiKey: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'Dub API key',
    },
    linkId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'The link ID or external ID prefixed with ext_',
    },
  },

  request: {
    url: (params) => `https://api.dub.co/links/${params.linkId.trim()}`,
    method: 'DELETE',
    headers: (params) => ({
      Accept: 'application/json',
      Authorization: `Bearer ${params.apiKey}`,
    }),
  },

  transformResponse: async (response: Response) => {
    const data = await response.json()

    if (!response.ok) {
      throw new Error(data.error?.message || data.error || 'Failed to delete link')
    }

    return {
      success: true,
      output: {
        id: data.id ?? '',
      },
    }
  },

  outputs: {
    id: { type: 'string', description: 'ID of the deleted link' },
  },
}
