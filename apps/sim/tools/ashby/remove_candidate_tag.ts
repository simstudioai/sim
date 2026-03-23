import type { ToolConfig, ToolResponse } from '@/tools/types'

interface AshbyRemoveCandidateTagParams {
  apiKey: string
  candidateId: string
  tagId: string
}

interface AshbyRemoveCandidateTagResponse extends ToolResponse {
  output: {
    success: boolean
  }
}

export const removeCandidateTagTool: ToolConfig<
  AshbyRemoveCandidateTagParams,
  AshbyRemoveCandidateTagResponse
> = {
  id: 'ashby_remove_candidate_tag',
  name: 'Ashby Remove Candidate Tag',
  description: 'Removes a tag from a candidate in Ashby.',
  version: '1.0.0',

  params: {
    apiKey: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'Ashby API Key',
    },
    candidateId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'The UUID of the candidate to remove the tag from',
    },
    tagId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'The UUID of the tag to remove',
    },
  },

  request: {
    url: 'https://api.ashbyhq.com/candidate.removeTag',
    method: 'POST',
    headers: (params) => ({
      'Content-Type': 'application/json',
      Authorization: `Basic ${btoa(`${params.apiKey}:`)}`,
    }),
    body: (params) => ({
      candidateId: params.candidateId,
      tagId: params.tagId,
    }),
  },

  transformResponse: async (response: Response) => {
    const data = await response.json()

    if (!data.success) {
      throw new Error(data.errorInfo?.message || 'Failed to remove tag from candidate')
    }

    return {
      success: true,
      output: {
        success: true,
      },
    }
  },

  outputs: {
    success: { type: 'boolean', description: 'Whether the tag was successfully removed' },
  },
}
