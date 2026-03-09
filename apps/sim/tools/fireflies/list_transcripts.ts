import type {
  FirefliesListTranscriptsParams,
  FirefliesListTranscriptsResponse,
} from '@/tools/fireflies/types'
import type { ToolConfig } from '@/tools/types'

export const firefliesListTranscriptsTool: ToolConfig<
  FirefliesListTranscriptsParams,
  FirefliesListTranscriptsResponse
> = {
  id: 'fireflies_list_transcripts',
  name: 'Fireflies List Transcripts',
  description: 'List meeting transcripts from Fireflies.ai with optional filtering',
  version: '1.0.0',

  params: {
    apiKey: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'Fireflies API key',
    },
    keyword: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Search keyword in meeting title or transcript (e.g., "quarterly review")',
    },
    fromDate: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Filter transcripts from this date (ISO 8601 format)',
    },
    toDate: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Filter transcripts until this date (ISO 8601 format)',
    },
    hostEmail: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Filter by meeting host email',
    },
    participants: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Filter by participant emails (comma-separated)',
    },
    limit: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Maximum number of transcripts to return (e.g., 10, max 50)',
    },
    skip: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Number of transcripts to skip for pagination (e.g., 0, 10, 20)',
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
      const variables: Record<string, unknown> = {}

      if (params.keyword) variables.keyword = params.keyword
      if (params.fromDate) variables.fromDate = params.fromDate
      if (params.toDate) variables.toDate = params.toDate
      if (params.hostEmail) variables.host_email = params.hostEmail
      if (params.participants) {
        variables.participants = params.participants.split(',').map((p) => p.trim())
      }
      if (params.limit) variables.limit = Math.min(Number(params.limit), 50)
      if (params.skip) variables.skip = Number(params.skip)

      return {
        query: `
          query Transcripts(
            $keyword: String
            $fromDate: DateTime
            $toDate: DateTime
            $host_email: String
            $participants: [String!]
            $limit: Int
            $skip: Int
          ) {
            transcripts(
              keyword: $keyword
              fromDate: $fromDate
              toDate: $toDate
              host_email: $host_email
              participants: $participants
              limit: $limit
              skip: $skip
            ) {
              id
              title
              date
              duration
              host_email
              participants
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
        error: data.errors[0]?.message || 'Failed to fetch transcripts',
        output: {},
      }
    }

    const transcripts = data.data?.transcripts || []
    return {
      success: true,
      output: {
        transcripts: transcripts.map(
          (t: {
            id: string
            title: string
            date: number
            duration: number
            host_email?: string
            participants?: string[]
          }) => ({
            id: t.id,
            title: t.title,
            date: t.date,
            duration: t.duration,
            host_email: t.host_email,
            participants: t.participants,
          })
        ),
        count: transcripts.length,
      },
    }
  },

  outputs: {
    transcripts: {
      type: 'array',
      description: 'List of transcripts',
    },
    count: {
      type: 'number',
      description: 'Number of transcripts returned',
    },
  },
}
