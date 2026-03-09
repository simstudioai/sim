import type { GongAggregateActivityParams, GongAggregateActivityResponse } from '@/tools/gong/types'
import type { ToolConfig } from '@/tools/types'

export const aggregateActivityTool: ToolConfig<
  GongAggregateActivityParams,
  GongAggregateActivityResponse
> = {
  id: 'gong_aggregate_activity',
  name: 'Gong Aggregate Activity',
  description: 'Retrieve aggregated activity statistics for users by date range from Gong.',
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
    url: 'https://api.gong.io/v2/stats/activity/aggregate',
    method: 'POST',
    headers: (params) => ({
      'Content-Type': 'application/json',
      Authorization: `Basic ${btoa(`${params.accessKey}:${params.accessKeySecret}`)}`,
    }),
    body: (params) => {
      const filter: Record<string, unknown> = {
        fromDate: params.fromDate,
        toDate: params.toDate,
      }
      if (params.userIds) {
        filter.userIds = params.userIds.split(',').map((id) => id.trim())
      }
      const body: Record<string, unknown> = { filter }
      if (params.cursor) body.cursor = params.cursor
      return body
    },
  },

  transformResponse: async (response: Response) => {
    const data = await response.json()
    if (!response.ok) {
      throw new Error(
        data.errors?.[0]?.message || data.message || 'Failed to get aggregate activity'
      )
    }
    const usersActivity = (data.usersAggregateActivityStats ?? []).map(
      (ua: Record<string, unknown>) => {
        const stats = (ua.userAggregateActivityStats ?? {}) as Record<string, unknown>
        return {
          userId: ua.userId ?? '',
          userEmailAddress: ua.userEmailAddress ?? null,
          callsAsHost: stats.callsAsHost ?? null,
          callsAttended: stats.callsAttended ?? null,
          callsGaveFeedback: stats.callsGaveFeedback ?? null,
          callsReceivedFeedback: stats.callsReceivedFeedback ?? null,
          callsRequestedFeedback: stats.callsRequestedFeedback ?? null,
          callsScorecardsFilled: stats.callsScorecardsFilled ?? null,
          callsScorecardsReceived: stats.callsScorecardsReceived ?? null,
          ownCallsListenedTo: stats.ownCallsListenedTo ?? null,
          othersCallsListenedTo: stats.othersCallsListenedTo ?? null,
          callsSharedInternally: stats.callsSharedInternally ?? null,
          callsSharedExternally: stats.callsSharedExternally ?? null,
          callsCommentsGiven: stats.callsCommentsGiven ?? null,
          callsCommentsReceived: stats.callsCommentsReceived ?? null,
          callsMarkedAsFeedbackGiven: stats.callsMarkedAsFeedbackGiven ?? null,
          callsMarkedAsFeedbackReceived: stats.callsMarkedAsFeedbackReceived ?? null,
        }
      }
    )
    return {
      success: true,
      output: {
        usersActivity,
        timeZone: data.timeZone ?? null,
        fromDateTime: data.fromDateTime ?? null,
        toDateTime: data.toDateTime ?? null,
        cursor: data.records?.cursor ?? null,
      },
    }
  },

  outputs: {
    usersActivity: {
      type: 'array',
      description: 'Aggregated activity statistics per user',
      items: {
        type: 'object',
        properties: {
          userId: { type: 'string', description: "Gong's unique numeric identifier for the user" },
          userEmailAddress: { type: 'string', description: 'Email address of the Gong user' },
          callsAsHost: { type: 'number', description: 'Number of recorded calls this user hosted' },
          callsAttended: {
            type: 'number',
            description: 'Number of calls where this user was a participant (not host)',
          },
          callsGaveFeedback: {
            type: 'number',
            description: 'Number of recorded calls the user gave feedback on',
          },
          callsReceivedFeedback: {
            type: 'number',
            description: 'Number of recorded calls the user received feedback on',
          },
          callsRequestedFeedback: {
            type: 'number',
            description: 'Number of recorded calls the user requested feedback on',
          },
          callsScorecardsFilled: {
            type: 'number',
            description: 'Number of scorecards the user completed',
          },
          callsScorecardsReceived: {
            type: 'number',
            description: "Number of calls where someone filled a scorecard on the user's calls",
          },
          ownCallsListenedTo: {
            type: 'number',
            description: "Number of the user's own calls the user listened to",
          },
          othersCallsListenedTo: {
            type: 'number',
            description: "Number of other users' calls the user listened to",
          },
          callsSharedInternally: {
            type: 'number',
            description: 'Number of calls the user shared internally',
          },
          callsSharedExternally: {
            type: 'number',
            description: 'Number of calls the user shared externally',
          },
          callsCommentsGiven: {
            type: 'number',
            description: 'Number of calls where the user provided at least one comment',
          },
          callsCommentsReceived: {
            type: 'number',
            description: 'Number of calls where the user received at least one comment',
          },
          callsMarkedAsFeedbackGiven: {
            type: 'number',
            description: 'Number of calls where the user selected Mark as reviewed',
          },
          callsMarkedAsFeedbackReceived: {
            type: 'number',
            description:
              "Number of calls where others selected Mark as reviewed on the user's calls",
          },
        },
      },
    },
    timeZone: {
      type: 'string',
      description: "The company's defined timezone in Gong",
    },
    fromDateTime: {
      type: 'string',
      description: 'Start of results in ISO-8601 format',
    },
    toDateTime: {
      type: 'string',
      description: 'End of results in ISO-8601 format',
    },
    cursor: {
      type: 'string',
      description: 'Pagination cursor for the next page',
    },
  },
}
