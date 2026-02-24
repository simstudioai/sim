import type { GongInteractionStatsParams, GongInteractionStatsResponse } from '@/tools/gong/types'
import type { ToolConfig } from '@/tools/types'

export const interactionStatsTool: ToolConfig<
  GongInteractionStatsParams,
  GongInteractionStatsResponse
> = {
  id: 'gong_interaction_stats',
  name: 'Gong Interaction Stats',
  description:
    'Retrieve interaction statistics for users by date range from Gong. Only includes calls with Whisper enabled.',
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
    url: 'https://api.gong.io/v2/stats/interaction',
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
        data.errors?.[0]?.message || data.message || 'Failed to get interaction stats'
      )
    }
    const peopleInteractionStats = (data.peopleInteractionStats ?? []).map(
      (entry: Record<string, unknown>) => ({
        userId: entry.userId ?? '',
        userEmailAddress: entry.userEmailAddress ?? null,
        personInteractionStats: (
          (entry.personInteractionStats as Record<string, unknown>[]) ?? []
        ).map((stat: Record<string, unknown>) => ({
          name: stat.name ?? '',
          value: stat.value ?? null,
        })),
      })
    )
    return {
      success: true,
      output: {
        peopleInteractionStats,
        timeZone: data.timeZone ?? null,
        fromDateTime: data.fromDateTime ?? null,
        toDateTime: data.toDateTime ?? null,
        cursor: data.records?.cursor ?? null,
      },
    }
  },

  outputs: {
    peopleInteractionStats: {
      type: 'array',
      description:
        "Interaction statistics per user. Applicable stat names: 'Longest Monologue', 'Longest Customer Story', 'Interactivity', 'Patience', 'Question Rate'.",
      items: {
        type: 'object',
        properties: {
          userId: { type: 'string', description: "Gong's unique numeric identifier for the user" },
          userEmailAddress: { type: 'string', description: 'Email address of the Gong user' },
          personInteractionStats: {
            type: 'array',
            description: 'List of interaction stat measurements for this user',
            items: {
              type: 'object',
              properties: {
                name: {
                  type: 'string',
                  description:
                    'Stat name (e.g. Longest Monologue, Interactivity, Patience, Question Rate)',
                },
                value: {
                  type: 'number',
                  description: 'Stat measurement value (can be double or integer)',
                },
              },
            },
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
