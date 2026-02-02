import type { FirefliesListBitesParams, FirefliesListBitesResponse } from '@/tools/fireflies/types'
import type { ToolConfig } from '@/tools/types'

export const firefliesListBitesTool: ToolConfig<
  FirefliesListBitesParams,
  FirefliesListBitesResponse
> = {
  id: 'fireflies_list_bites',
  name: 'Fireflies List Bites',
  description: 'List soundbites/highlights from Fireflies.ai',
  version: '1.0.0',

  params: {
    apiKey: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'Fireflies API key',
    },
    transcriptId: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Filter bites for a specific transcript (e.g., "abc123def456")',
    },
    mine: {
      type: 'boolean',
      required: false,
      visibility: 'user-or-llm',
      description: 'Only return bites owned by the API key owner (default: true)',
    },
    limit: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Maximum number of bites to return (e.g., 10, max 50)',
    },
    skip: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Number of bites to skip for pagination (e.g., 0, 10, 20)',
    },
  },

  request: {
    url: 'https://api.fireflies.ai/graphql',
    method: 'POST',
    headers: (params) => {
      if (!params.apiKey) {
        throw new Error('Missing API key for Fireflies API request')
      }
      return {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${params.apiKey}`,
      }
    },
    body: (params) => {
      const variables: Record<string, unknown> = {
        mine: params.mine !== false,
      }

      if (params.transcriptId) variables.transcript_id = params.transcriptId
      if (params.limit) variables.limit = Math.min(Number(params.limit), 50)
      if (params.skip) variables.skip = Number(params.skip)

      return {
        query: `
          query Bites(
            $mine: Boolean
            $transcript_id: ID
            $limit: Int
            $skip: Int
          ) {
            bites(
              mine: $mine
              transcript_id: $transcript_id
              limit: $limit
              skip: $skip
            ) {
              id
              name
              transcript_id
              user_id
              start_time
              end_time
              status
              summary
              media_type
              thumbnail
              preview
              created_at
            }
          }
        `,
        variables,
      }
    },
  },

  transformResponse: async (response) => {
    const data = await response.json()

    if (data.errors) {
      return {
        success: false,
        error: data.errors[0]?.message || 'Failed to fetch bites',
        output: {},
      }
    }

    const bites = data.data?.bites || []
    return {
      success: true,
      output: {
        bites: bites.map(
          (b: {
            id: string
            name?: string
            transcript_id?: string
            user_id?: string
            start_time?: number
            end_time?: number
            status?: string
            summary?: string
            media_type?: string
            thumbnail?: string
            preview?: string
            created_at?: string
          }) => ({
            id: b.id,
            name: b.name,
            transcript_id: b.transcript_id,
            user_id: b.user_id,
            start_time: b.start_time,
            end_time: b.end_time,
            status: b.status,
            summary: b.summary,
            media_type: b.media_type,
            thumbnail: b.thumbnail,
            preview: b.preview,
            created_at: b.created_at,
          })
        ),
      },
    }
  },

  outputs: {
    bites: {
      type: 'array',
      description: 'List of bites/soundbites',
    },
  },
}
