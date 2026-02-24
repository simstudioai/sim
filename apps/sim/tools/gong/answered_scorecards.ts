import type {
  GongAnsweredScorecardsParams,
  GongAnsweredScorecardsResponse,
} from '@/tools/gong/types'
import type { ToolConfig } from '@/tools/types'

export const answeredScorecardsTool: ToolConfig<
  GongAnsweredScorecardsParams,
  GongAnsweredScorecardsResponse
> = {
  id: 'gong_answered_scorecards',
  name: 'Gong Answered Scorecards',
  description: 'Retrieve answered scorecards for reviewed users or by date range from Gong.',
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
    callFromDate: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Start date for calls in YYYY-MM-DD format (inclusive, in company timezone). Defaults to earliest recorded call.',
    },
    callToDate: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        'End date for calls in YYYY-MM-DD format (exclusive, in company timezone). Defaults to latest recorded call.',
    },
    reviewFromDate: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Start date for reviews in YYYY-MM-DD format (inclusive, in company timezone). Defaults to earliest reviewed call.',
    },
    reviewToDate: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        'End date for reviews in YYYY-MM-DD format (exclusive, in company timezone). Defaults to latest reviewed call.',
    },
    scorecardIds: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Comma-separated list of scorecard IDs to filter by',
    },
    reviewedUserIds: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Comma-separated list of reviewed user IDs to filter by',
    },
    cursor: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Pagination cursor from a previous response',
    },
  },

  request: {
    url: 'https://api.gong.io/v2/stats/activity/scorecards',
    method: 'POST',
    headers: (params) => ({
      'Content-Type': 'application/json',
      Authorization: `Basic ${btoa(`${params.accessKey}:${params.accessKeySecret}`)}`,
    }),
    body: (params) => {
      const filter: Record<string, unknown> = {}
      if (params.callFromDate) filter.callFromDate = params.callFromDate
      if (params.callToDate) filter.callToDate = params.callToDate
      if (params.reviewFromDate) filter.reviewFromDate = params.reviewFromDate
      if (params.reviewToDate) filter.reviewToDate = params.reviewToDate
      if (params.scorecardIds) {
        filter.scorecardIds = params.scorecardIds.split(',').map((id) => id.trim())
      }
      if (params.reviewedUserIds) {
        filter.reviewedUserIds = params.reviewedUserIds.split(',').map((id) => id.trim())
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
        data.errors?.[0]?.message || data.message || 'Failed to get answered scorecards'
      )
    }
    const answeredScorecards = (data.answeredScorecards ?? []).map(
      (sc: Record<string, unknown>) => ({
        answeredScorecardId: sc.answeredScorecardId ?? 0,
        scorecardId: sc.scorecardId ?? null,
        scorecardName: sc.scorecardName ?? null,
        callId: sc.callId ?? null,
        callStartTime: sc.callStartTime ?? null,
        reviewedUserId: sc.reviewedUserId ?? null,
        reviewerUserId: sc.reviewerUserId ?? null,
        reviewTime: sc.reviewTime ?? null,
        visibilityType: sc.visibilityType ?? null,
        answers: ((sc.answers as Record<string, unknown>[]) ?? []).map(
          (answer: Record<string, unknown>) => ({
            questionId: answer.questionId ?? null,
            questionRevisionId: answer.questionRevisionId ?? null,
            isOverall: answer.isOverall ?? null,
            score: answer.score ?? null,
            answerText: answer.answerText ?? null,
            notApplicable: answer.notApplicable ?? null,
          })
        ),
      })
    )
    return {
      success: true,
      output: {
        answeredScorecards,
        cursor: data.records?.cursor ?? null,
      },
    }
  },

  outputs: {
    answeredScorecards: {
      type: 'array',
      description: 'List of answered scorecards with scores and answers',
      items: {
        type: 'object',
        properties: {
          answeredScorecardId: {
            type: 'number',
            description: 'Identifier of the answered scorecard',
          },
          scorecardId: { type: 'number', description: 'Identifier of the scorecard' },
          scorecardName: { type: 'string', description: 'Scorecard name' },
          callId: { type: 'number', description: "Gong's unique numeric identifier for the call" },
          callStartTime: {
            type: 'string',
            description: 'Date/time of the call in ISO-8601 format',
          },
          reviewedUserId: {
            type: 'number',
            description: 'User ID of the team member being reviewed',
          },
          reviewerUserId: {
            type: 'number',
            description: 'User ID of the team member who completed the scorecard',
          },
          reviewTime: {
            type: 'string',
            description: 'Date/time when the review was completed in ISO-8601 format',
          },
          visibilityType: {
            type: 'string',
            description: 'Visibility type of the scorecard answer',
          },
          answers: {
            type: 'array',
            description: 'Answers in the answered scorecard',
            items: {
              type: 'object',
              properties: {
                questionId: { type: 'number', description: 'Identifier of the question' },
                questionRevisionId: {
                  type: 'number',
                  description: 'Identifier of the revision version of the question',
                },
                isOverall: { type: 'boolean', description: 'Whether this is the overall question' },
                score: {
                  type: 'number',
                  description: 'Score between 1 to 5 if answered, null otherwise',
                },
                answerText: {
                  type: 'string',
                  description: "The answer's text if answered, null otherwise",
                },
                notApplicable: {
                  type: 'boolean',
                  description: 'Whether the question is not applicable to this call',
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
    },
  },
}
