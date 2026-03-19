import type { ToolConfig, ToolResponse } from '@/tools/types'

interface AshbyListCandidateTagsParams {
  apiKey: string
}

interface AshbyListCandidateTagsResponse extends ToolResponse {
  output: {
    tags: Array<{
      id: string
      title: string
      isArchived: boolean
    }>
  }
}

export const listCandidateTagsTool: ToolConfig<
  AshbyListCandidateTagsParams,
  AshbyListCandidateTagsResponse
> = {
  id: 'ashby_list_candidate_tags',
  name: 'Ashby List Candidate Tags',
  description: 'Lists all candidate tags configured in Ashby.',
  version: '1.0.0',

  params: {
    apiKey: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'Ashby API Key',
    },
  },

  request: {
    url: 'https://api.ashbyhq.com/candidateTag.list',
    method: 'POST',
    headers: (params) => ({
      'Content-Type': 'application/json',
      Authorization: `Basic ${btoa(`${params.apiKey}:`)}`,
    }),
    body: () => ({}),
  },

  transformResponse: async (response: Response) => {
    const data = await response.json()

    if (!data.success) {
      throw new Error(data.errorInfo?.message || 'Failed to list candidate tags')
    }

    return {
      success: true,
      output: {
        tags: (data.results ?? []).map((t: Record<string, unknown>) => ({
          id: t.id ?? null,
          title: t.title ?? null,
          isArchived: t.isArchived ?? false,
        })),
      },
    }
  },

  outputs: {
    tags: {
      type: 'array',
      description: 'List of candidate tags',
      items: {
        type: 'object',
        properties: {
          id: { type: 'string', description: 'Tag UUID' },
          title: { type: 'string', description: 'Tag title' },
          isArchived: { type: 'boolean', description: 'Whether the tag is archived' },
        },
      },
    },
  },
}
