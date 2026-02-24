import type { GongListScorecardsParams, GongListScorecardsResponse } from '@/tools/gong/types'
import type { ToolConfig } from '@/tools/types'

export const listScorecardsTool: ToolConfig<GongListScorecardsParams, GongListScorecardsResponse> =
  {
    id: 'gong_list_scorecards',
    name: 'Gong List Scorecards',
    description: 'Retrieve scorecard definitions from Gong settings.',
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
    },

    request: {
      url: 'https://api.gong.io/v2/settings/scorecards',
      method: 'GET',
      headers: (params) => ({
        'Content-Type': 'application/json',
        Authorization: `Basic ${btoa(`${params.accessKey}:${params.accessKeySecret}`)}`,
      }),
    },

    transformResponse: async (response: Response) => {
      const data = await response.json()
      if (!response.ok) {
        throw new Error(data.errors?.[0]?.message || data.message || 'Failed to list scorecards')
      }
      const scorecards = (data.scorecards ?? []).map((sc: Record<string, unknown>) => ({
        scorecardId: sc.scorecardId ?? '',
        scorecardName: sc.scorecardName ?? '',
        workspaceId: sc.workspaceId ?? null,
        enabled: sc.enabled ?? false,
        updaterUserId: sc.updaterUserId ?? null,
        created: sc.created ?? null,
        updated: sc.updated ?? null,
        questions: ((sc.questions as Record<string, unknown>[] | undefined) ?? []).map(
          (q: Record<string, unknown>) => ({
            questionId: q.questionId ?? '',
            questionText: q.questionText ?? '',
            questionRevisionId: q.questionRevisionId ?? null,
            isOverall: q.isOverall ?? false,
            created: q.created ?? null,
            updated: q.updated ?? null,
            updaterUserId: q.updaterUserId ?? null,
          })
        ),
      }))
      return {
        success: true,
        output: { scorecards },
      }
    },

    outputs: {
      scorecards: {
        type: 'array',
        description: 'List of scorecard definitions with questions',
        items: {
          type: 'object',
          properties: {
            scorecardId: { type: 'string', description: 'Unique identifier for the scorecard' },
            scorecardName: { type: 'string', description: 'Display name of the scorecard' },
            workspaceId: {
              type: 'string',
              description: 'Workspace identifier associated with this scorecard',
            },
            enabled: { type: 'boolean', description: 'Whether the scorecard is active' },
            updaterUserId: {
              type: 'string',
              description: 'ID of the user who last modified the scorecard',
            },
            created: {
              type: 'string',
              description: 'Creation timestamp in ISO-8601 format',
            },
            updated: {
              type: 'string',
              description: 'Last update timestamp in ISO-8601 format',
            },
            questions: {
              type: 'array',
              description: 'List of questions in the scorecard',
              items: {
                type: 'object',
                properties: {
                  questionId: { type: 'string', description: 'Unique identifier for the question' },
                  questionText: { type: 'string', description: 'The text content of the question' },
                  questionRevisionId: {
                    type: 'string',
                    description: 'Identifier for the specific revision of the question',
                  },
                  isOverall: {
                    type: 'boolean',
                    description: 'Whether this is the primary overall question',
                  },
                  created: {
                    type: 'string',
                    description: 'Question creation timestamp in ISO-8601 format',
                  },
                  updated: {
                    type: 'string',
                    description: 'Question last update timestamp in ISO-8601 format',
                  },
                  updaterUserId: {
                    type: 'string',
                    description: 'ID of the user who last modified the question',
                  },
                },
              },
            },
          },
        },
      },
    },
  }
