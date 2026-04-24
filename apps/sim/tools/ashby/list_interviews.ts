import type { AshbyUserSummary } from '@/tools/ashby/types'
import { mapUserSummary, USER_SUMMARY_OUTPUT } from '@/tools/ashby/utils'
import type { ToolConfig, ToolResponse } from '@/tools/types'

interface AshbyListInterviewSchedulesParams {
  apiKey: string
  applicationId?: string
  interviewStageId?: string
  cursor?: string
  perPage?: number
}

interface AshbyInterviewEvent {
  id: string
  interviewId: string | null
  interviewScheduleId: string | null
  interviewerUserIds: string[]
  createdAt: string | null
  updatedAt: string | null
  startTime: string | null
  endTime: string | null
  feedbackLink: string | null
  location: string | null
  meetingLink: string | null
  hasSubmittedFeedback: boolean
}

interface AshbyInterviewSchedule {
  id: string
  status: string | null
  applicationId: string
  interviewStageId: string | null
  scheduledBy: AshbyUserSummary | null
  createdAt: string | null
  updatedAt: string | null
  interviewEvents: AshbyInterviewEvent[]
}

interface AshbyListInterviewSchedulesResponse extends ToolResponse {
  output: {
    interviewSchedules: AshbyInterviewSchedule[]
    moreDataAvailable: boolean
    nextCursor: string | null
  }
}

type UnknownRecord = Record<string, unknown>

function mapInterviewEvent(raw: unknown): AshbyInterviewEvent | null {
  if (!raw || typeof raw !== 'object') return null
  const e = raw as UnknownRecord
  return {
    id: (e.id as string) ?? '',
    interviewId: (e.interviewId as string) ?? null,
    interviewScheduleId: (e.interviewScheduleId as string) ?? null,
    interviewerUserIds: Array.isArray(e.interviewerUserIds)
      ? (e.interviewerUserIds as string[])
      : [],
    createdAt: (e.createdAt as string) ?? null,
    updatedAt: (e.updatedAt as string) ?? null,
    startTime: (e.startTime as string) ?? null,
    endTime: (e.endTime as string) ?? null,
    feedbackLink: (e.feedbackLink as string) ?? null,
    location: (e.location as string) ?? null,
    meetingLink: (e.meetingLink as string) ?? null,
    hasSubmittedFeedback: (e.hasSubmittedFeedback as boolean) ?? false,
  }
}

function mapInterviewSchedule(raw: unknown): AshbyInterviewSchedule {
  const s = (raw ?? {}) as UnknownRecord
  return {
    id: (s.id as string) ?? '',
    status: (s.status as string) ?? null,
    applicationId: (s.applicationId as string) ?? '',
    interviewStageId: (s.interviewStageId as string) ?? null,
    scheduledBy: mapUserSummary(s.scheduledBy),
    createdAt: (s.createdAt as string) ?? null,
    updatedAt: (s.updatedAt as string) ?? null,
    interviewEvents: Array.isArray(s.interviewEvents)
      ? (s.interviewEvents as unknown[])
          .map(mapInterviewEvent)
          .filter((e): e is AshbyInterviewEvent => e !== null)
      : [],
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
      if (params.applicationId) body.applicationId = params.applicationId.trim()
      if (params.interviewStageId) body.interviewStageId = params.interviewStageId.trim()
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
        interviewSchedules: (data.results ?? []).map(mapInterviewSchedule),
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
          status: {
            type: 'string',
            description:
              'Schedule status (NeedsScheduling, WaitingOnCandidateBooking, Scheduled, Complete, Cancelled, OnHold, etc.)',
            optional: true,
          },
          applicationId: { type: 'string', description: 'Associated application UUID' },
          interviewStageId: {
            type: 'string',
            description: 'Interview stage UUID',
            optional: true,
          },
          scheduledBy: {
            ...USER_SUMMARY_OUTPUT,
            description: 'User who scheduled the interview (null if not yet scheduled)',
          },
          createdAt: {
            type: 'string',
            description: 'ISO 8601 creation timestamp',
            optional: true,
          },
          updatedAt: {
            type: 'string',
            description: 'ISO 8601 last update timestamp',
            optional: true,
          },
          interviewEvents: {
            type: 'array',
            description: 'Scheduled interview events on this schedule',
            items: {
              type: 'object',
              properties: {
                id: { type: 'string', description: 'Event UUID' },
                interviewId: {
                  type: 'string',
                  description: 'Interview template UUID',
                  optional: true,
                },
                interviewScheduleId: {
                  type: 'string',
                  description: 'Parent schedule UUID',
                  optional: true,
                },
                interviewerUserIds: {
                  type: 'array',
                  description: 'User UUIDs of interviewers assigned to the event',
                  items: { type: 'string', description: 'User UUID' },
                },
                createdAt: {
                  type: 'string',
                  description: 'Event creation timestamp',
                  optional: true,
                },
                updatedAt: {
                  type: 'string',
                  description: 'Event last updated timestamp',
                  optional: true,
                },
                startTime: {
                  type: 'string',
                  description: 'Event start time',
                  optional: true,
                },
                endTime: { type: 'string', description: 'Event end time', optional: true },
                feedbackLink: {
                  type: 'string',
                  description: 'URL to submit feedback for the event',
                  optional: true,
                },
                location: {
                  type: 'string',
                  description: 'Physical location',
                  optional: true,
                },
                meetingLink: {
                  type: 'string',
                  description: 'Virtual meeting URL',
                  optional: true,
                },
                hasSubmittedFeedback: {
                  type: 'boolean',
                  description: 'Whether any feedback has been submitted',
                },
              },
            },
          },
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
