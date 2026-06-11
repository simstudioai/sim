import type { GongDayByDayActivityParams, GongDayByDayActivityResponse } from '@/tools/gong/types'
import { getGongErrorMessage, parseGongIdList } from '@/tools/gong/utils'
import type { ToolConfig } from '@/tools/types'

export const dayByDayActivityTool: ToolConfig<
  GongDayByDayActivityParams,
  GongDayByDayActivityResponse
> = {
  id: 'gong_day_by_day_activity',
  name: 'Gong Day-by-Day Activity',
  description:
    'Retrieve detailed day-by-day activity (call IDs per activity type) for users by date range from Gong.',
  version: '1.0.0',

  params: {
    accessKey: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'Gong API Access Key',
    },
    accessKeySecret: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'Gong API Access Key Secret',
    },
    userIds: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Comma-separated list of Gong user IDs (up to 20 digits each)',
    },
    fromDate: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Start date in YYYY-MM-DD format (inclusive, in company timezone)',
    },
    toDate: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description:
        'End date in YYYY-MM-DD format (exclusive, in company timezone, cannot exceed current day)',
    },
    cursor: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Pagination cursor from a previous response',
    },
  },

  request: {
    url: 'https://api.gong.io/v2/stats/activity/day-by-day',
    method: 'POST',
    headers: (params) => ({
      'Content-Type': 'application/json',
      Authorization: `Basic ${btoa(`${params.accessKey}:${params.accessKeySecret}`)}`,
    }),
    body: (params) => {
      const filter: Record<string, unknown> = {
        fromDate: params.fromDate.trim(),
        toDate: params.toDate.trim(),
      }
      const userIds = parseGongIdList(params.userIds)
      if (userIds) filter.userIds = userIds
      const body: Record<string, unknown> = { filter }
      if (params.cursor?.trim()) body.cursor = params.cursor.trim()
      return body
    },
  },

  transformResponse: async (response: Response) => {
    const data = await response.json()
    if (!response.ok) {
      throw new Error(getGongErrorMessage(data, 'Failed to get day-by-day activity'))
    }
    const usersDetailedActivities = (data.usersDetailedActivities ?? []).map(
      (ud: Record<string, unknown>) => ({
        userId: ud.userId ?? '',
        userEmailAddress: ud.userEmailAddress ?? null,
        userDailyActivityStats: (
          (ud.userDailyActivityStats as Record<string, unknown>[] | undefined) ?? []
        ).map((day: Record<string, unknown>) => ({
          fromDate: day.fromDate ?? null,
          toDate: day.toDate ?? null,
          callsAsHost: day.callsAsHost ?? [],
          callsAttended: day.callsAttended ?? [],
          callsGaveFeedback: day.callsGaveFeedback ?? [],
          callsReceivedFeedback: day.callsReceivedFeedback ?? [],
          callsRequestedFeedback: day.callsRequestedFeedback ?? [],
          callsScorecardsFilled: day.callsScorecardsFilled ?? [],
          callsScorecardsReceived: day.callsScorecardsReceived ?? [],
          ownCallsListenedTo: day.ownCallsListenedTo ?? [],
          othersCallsListenedTo: day.othersCallsListenedTo ?? [],
          callsSharedInternally: day.callsSharedInternally ?? [],
          callsSharedExternally: day.callsSharedExternally ?? [],
          callsCommentsGiven: day.callsCommentsGiven ?? [],
          callsCommentsReceived: day.callsCommentsReceived ?? [],
          callsMarkedAsFeedbackGiven: day.callsMarkedAsFeedbackGiven ?? [],
          callsMarkedAsFeedbackReceived: day.callsMarkedAsFeedbackReceived ?? [],
        })),
      })
    )
    return {
      success: true,
      output: {
        requestId: data.requestId ?? null,
        usersDetailedActivities,
        cursor: data.records?.cursor ?? null,
      },
    }
  },

  outputs: {
    requestId: {
      type: 'string',
      description: 'A Gong request reference ID for troubleshooting purposes',
      optional: true,
    },
    usersDetailedActivities: {
      type: 'array',
      description: 'Day-by-day activity per user, with call IDs grouped by activity type',
      items: {
        type: 'object',
        properties: {
          userId: { type: 'string', description: "Gong's unique numeric identifier for the user" },
          userEmailAddress: { type: 'string', description: 'Email address of the Gong user' },
          userDailyActivityStats: {
            type: 'array',
            description: 'One record per day in the date range',
            items: {
              type: 'object',
              properties: {
                fromDate: { type: 'string', description: 'Start of the day (ISO-8601)' },
                toDate: { type: 'string', description: 'End of the day (ISO-8601)' },
                callsAsHost: { type: 'array', description: 'IDs of calls the user hosted' },
                callsAttended: {
                  type: 'array',
                  description: 'IDs of calls the user attended (not host)',
                },
                callsGaveFeedback: {
                  type: 'array',
                  description: 'IDs of calls the user gave feedback on',
                },
                callsReceivedFeedback: {
                  type: 'array',
                  description: 'IDs of calls the user received feedback on',
                },
                callsRequestedFeedback: {
                  type: 'array',
                  description: 'IDs of calls the user requested feedback on',
                },
                callsScorecardsFilled: {
                  type: 'array',
                  description: 'IDs of calls the user filled scorecards on',
                },
                callsScorecardsReceived: {
                  type: 'array',
                  description: "IDs of the user's calls that received a scorecard",
                },
                ownCallsListenedTo: {
                  type: 'array',
                  description: "IDs of the user's own calls the user listened to",
                },
                othersCallsListenedTo: {
                  type: 'array',
                  description: "IDs of other users' calls the user listened to",
                },
                callsSharedInternally: {
                  type: 'array',
                  description: 'IDs of calls the user shared internally',
                },
                callsSharedExternally: {
                  type: 'array',
                  description: 'IDs of calls the user shared externally',
                },
                callsCommentsGiven: {
                  type: 'array',
                  description: 'IDs of calls the user commented on',
                },
                callsCommentsReceived: {
                  type: 'array',
                  description: "IDs of the user's calls that received a comment",
                },
                callsMarkedAsFeedbackGiven: {
                  type: 'array',
                  description: 'IDs of calls the user marked as reviewed',
                },
                callsMarkedAsFeedbackReceived: {
                  type: 'array',
                  description: "IDs of the user's calls marked as reviewed by others",
                },
              },
            },
          },
        },
      },
    },
    cursor: {
      type: 'string',
      description: 'Pagination cursor for the next page',
      optional: true,
    },
  },
}
