import type { GongAggregateByPeriodParams, GongAggregateByPeriodResponse } from '@/tools/gong/types'
import { getGongErrorMessage, parseGongIdList } from '@/tools/gong/utils'
import type { ToolConfig } from '@/tools/types'

export const aggregateByPeriodTool: ToolConfig<
  GongAggregateByPeriodParams,
  GongAggregateByPeriodResponse
> = {
  id: 'gong_aggregate_by_period',
  name: 'Gong Aggregate by Period',
  description:
    'Retrieve aggregated user activity grouped into time periods (day, week, month, quarter, year) by date range from Gong.',
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
    aggregationPeriod: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description:
        'Calendar period to group activity by: DAY, WEEK, MONTH, QUARTER, or YEAR (week starts Monday)',
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
    url: 'https://api.gong.io/v2/stats/activity/aggregate-by-period',
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
      const body: Record<string, unknown> = {
        aggregationPeriod: params.aggregationPeriod.trim().toUpperCase(),
        filter,
      }
      if (params.cursor?.trim()) body.cursor = params.cursor.trim()
      return body
    },
  },

  transformResponse: async (response: Response) => {
    const data = await response.json()
    if (!response.ok) {
      throw new Error(getGongErrorMessage(data, 'Failed to get aggregate-by-period activity'))
    }
    const usersAggregateActivity = (data.usersAggregateActivity ?? []).map(
      (ua: Record<string, unknown>) => ({
        userId: ua.userId ?? '',
        userEmailAddress: ua.userEmailAddress ?? null,
        userAggregateActivity: (
          (ua.userAggregateActivity as Record<string, unknown>[] | undefined) ?? []
        ).map((period: Record<string, unknown>) => ({
          fromDate: period.fromDate ?? null,
          toDate: period.toDate ?? null,
          callsAsHost: period.callsAsHost ?? null,
          callsAttended: period.callsAttended ?? null,
          callsGaveFeedback: period.callsGaveFeedback ?? null,
          callsReceivedFeedback: period.callsReceivedFeedback ?? null,
          callsRequestedFeedback: period.callsRequestedFeedback ?? null,
          callsScorecardsFilled: period.callsScorecardsFilled ?? null,
          callsScorecardsReceived: period.callsScorecardsReceived ?? null,
          ownCallsListenedTo: period.ownCallsListenedTo ?? null,
          othersCallsListenedTo: period.othersCallsListenedTo ?? null,
          callsSharedInternally: period.callsSharedInternally ?? null,
          callsSharedExternally: period.callsSharedExternally ?? null,
          callsCommentsGiven: period.callsCommentsGiven ?? null,
          callsCommentsReceived: period.callsCommentsReceived ?? null,
          callsMarkedAsFeedbackGiven: period.callsMarkedAsFeedbackGiven ?? null,
          callsMarkedAsFeedbackReceived: period.callsMarkedAsFeedbackReceived ?? null,
        })),
      })
    )
    return {
      success: true,
      output: {
        requestId: data.requestId ?? null,
        usersAggregateActivity,
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
    usersAggregateActivity: {
      type: 'array',
      description:
        'Aggregated activity per user, one item per consecutive time period in the range',
      items: {
        type: 'object',
        properties: {
          userId: { type: 'string', description: "Gong's unique numeric identifier for the user" },
          userEmailAddress: { type: 'string', description: 'Email address of the Gong user' },
          userAggregateActivity: {
            type: 'array',
            description: 'Activity counts per time period',
            items: {
              type: 'object',
              properties: {
                fromDate: { type: 'string', description: 'Start of the period (ISO-8601)' },
                toDate: { type: 'string', description: 'End of the period (ISO-8601)' },
                callsAsHost: { type: 'number', description: 'Calls the user hosted' },
                callsAttended: {
                  type: 'number',
                  description: 'Calls the user attended (not host)',
                },
                callsGaveFeedback: {
                  type: 'number',
                  description: 'Calls the user gave feedback on',
                },
                callsReceivedFeedback: {
                  type: 'number',
                  description: 'Calls the user received feedback on',
                },
                callsRequestedFeedback: {
                  type: 'number',
                  description: 'Calls the user requested feedback on',
                },
                callsScorecardsFilled: {
                  type: 'number',
                  description: 'Scorecards the user completed',
                },
                callsScorecardsReceived: {
                  type: 'number',
                  description: "Calls where someone filled a scorecard on the user's calls",
                },
                ownCallsListenedTo: {
                  type: 'number',
                  description: "The user's own calls the user listened to",
                },
                othersCallsListenedTo: {
                  type: 'number',
                  description: "Other users' calls the user listened to",
                },
                callsSharedInternally: {
                  type: 'number',
                  description: 'Calls the user shared internally',
                },
                callsSharedExternally: {
                  type: 'number',
                  description: 'Calls the user shared externally',
                },
                callsCommentsGiven: {
                  type: 'number',
                  description: 'Calls the user commented on',
                },
                callsCommentsReceived: {
                  type: 'number',
                  description: "Calls where the user's calls received a comment",
                },
                callsMarkedAsFeedbackGiven: {
                  type: 'number',
                  description: 'Calls the user marked as reviewed',
                },
                callsMarkedAsFeedbackReceived: {
                  type: 'number',
                  description: "The user's calls marked as reviewed by others",
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
