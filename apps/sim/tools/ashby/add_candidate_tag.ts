import type { ToolConfig, ToolResponse } from '@/tools/types'

interface AshbyAddCandidateTagParams {
  apiKey: string
  candidateId: string
  tagId: string
}

interface AshbyAddCandidateTagResponse extends ToolResponse {
  output: {
    success: boolean
  }
}

export const addCandidateTagTool: ToolConfig<
  AshbyAddCandidateTagParams,
  AshbyAddCandidateTagResponse
> = {
  id: 'ashby_add_candidate_tag',
  name: 'Ashby Add Candidate Tag',
  description: 'Adds a tag to a candidate in Ashby.',
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
      description: 'The UUID of the candidate to add the tag to',
    },
    tagId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'The UUID of the tag to add',
    },
  },

  request: {
    url: 'https://api.ashbyhq.com/candidate.addTag',
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
      throw new Error(data.errorInfo?.message || 'Failed to add tag to candidate')
    }

    return {
      success: true,
      output: {
        success: true,
      },
    }
  },

  outputs: {
    success: { type: 'boolean', description: 'Whether the tag was successfully added' },
  },
}
