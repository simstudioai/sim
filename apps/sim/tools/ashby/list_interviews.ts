import type { ToolConfig, ToolResponse } from '@/tools/types'

interface AshbyListInterviewSchedulesParams {
  apiKey: string
  applicationId?: string
  interviewStageId?: string
  cursor?: string
  perPage?: number
}

interface AshbyListInterviewSchedulesResponse extends ToolResponse {
  output: {
    interviewSchedules: Array<{
      id: string
      applicationId: string
      interviewStageId: string | null
      status: string | null
      createdAt: string
    }>
    moreDataAvailable: boolean
    nextCursor: string | null
  }
}

export const listInterviewsTool: ToolConfig<
  AshbyListInterviewSchedulesParams,
  AshbyListInterviewSchedulesResponse
> = {
  id: 'ashby_list_interviews',
  name: 'Ashby List Interview Schedules',
  description:
    'Lists interview schedules in Ashby, optionally filtered by application or interview stage.',
  version: '1.0.0',

  params: {
    apiKey: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'Ashby API Key',
    },
    applicationId: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'The UUID of the application to list interview schedules for',
    },
    interviewStageId: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'The UUID of the interview stage to list interview schedules for',
    },
    cursor: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Opaque pagination cursor from a previous response nextCursor value',
    },
    perPage: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Number of results per page (default 100)',
    },
  },

  request: {
    url: 'https://api.ashbyhq.com/interviewSchedule.list',
    method: 'POST',
    headers: (params) => ({
      'Content-Type': 'application/json',
      Authorization: `Basic ${btoa(`${params.apiKey}:`)}`,
    }),
    body: (params) => {
      const body: Record<string, unknown> = {}
      if (params.applicationId) body.applicationId = params.applicationId
      if (params.interviewStageId) body.interviewStageId = params.interviewStageId
      if (params.cursor) body.cursor = params.cursor
      if (params.perPage) body.limit = params.perPage
      return body
    },
  },

  transformResponse: async (response: Response) => {
    const data = await response.json()

    if (!data.success) {
      throw new Error(data.errorInfo?.message || 'Failed to list interview schedules')
    }

    return {
      success: true,
      output: {
        interviewSchedules: (data.results ?? []).map((s: Record<string, unknown>) => ({
          id: s.id ?? null,
          applicationId: s.applicationId ?? null,
          interviewStageId: s.interviewStageId ?? null,
          status: s.status ?? null,
          createdAt: s.createdAt ?? null,
        })),
        moreDataAvailable: data.moreDataAvailable ?? false,
        nextCursor: data.nextCursor ?? null,
      },
    }
  },

  outputs: {
    interviewSchedules: {
      type: 'array',
      description: 'List of interview schedules',
      items: {
        type: 'object',
        properties: {
          id: { type: 'string', description: 'Interview schedule UUID' },
          applicationId: { type: 'string', description: 'Associated application UUID' },
          interviewStageId: {
            type: 'string',
            description: 'Interview stage UUID',
            optional: true,
          },
          status: { type: 'string', description: 'Schedule status', optional: true },
          createdAt: { type: 'string', description: 'ISO 8601 creation timestamp' },
        },
      },
    },
    moreDataAvailable: {
      type: 'boolean',
      description: 'Whether more pages of results exist',
    },
    nextCursor: {
      type: 'string',
      description: 'Opaque cursor for fetching the next page',
      optional: true,
    },
  },
}
