import type { GongListScorecardsParams, GongListScorecardsResponse } from '@/tools/gong/types'
import { getGongErrorMessage } from '@/tools/gong/utils'
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
        throw new Error(getGongErrorMessage(data, 'Failed to list scorecards'))
      }
      const scorecards = (data.scorecards ?? []).map((sc: Record<string, unknown>) => ({
        scorecardId: sc.scorecardId ?? null,
        scorecardName: sc.scorecardName ?? '',
        workspaceId: sc.workspaceId ?? null,
        enabled: sc.enabled ?? false,
        updaterUserId: sc.updaterUserId ?? null,
        created: sc.created ?? null,
        updated: sc.updated ?? null,
        reviewMethod: sc.reviewMethod ?? null,
        questions: ((sc.questions as Record<string, unknown>[] | undefined) ?? []).map(
          (q: Record<string, unknown>) => ({
            questionId: q.questionId ?? null,
            questionRevisionId: q.questionRevisionId ?? null,
            questionText: q.questionText ?? '',
            isOverall: q.isOverall ?? false,
            questionType: q.questionType ?? null,
            answerGuide: q.answerGuide ?? null,
            minRange: q.minRange ?? null,
            maxRange: q.maxRange ?? null,
            answerOptions: q.answerOptions ?? [],
          })
        ),
      }))
      return {
        success: true,
        output: {
          requestId: data.requestId ?? null,
          scorecards,
        },
      }
    },

    outputs: {
      requestId: {
        type: 'string',
        description: 'A Gong request reference ID for troubleshooting purposes',
        optional: true,
      },
      scorecards: {
        type: 'array',
        description: 'List of scorecard definitions with questions',
        items: {
          type: 'object',
          properties: {
            scorecardId: { type: 'number', description: 'Unique identifier for the scorecard' },
            scorecardName: { type: 'string', description: 'Display name of the scorecard' },
            workspaceId: {
              type: 'number',
              description: 'Workspace identifier associated with this scorecard',
            },
            enabled: { type: 'boolean', description: 'Whether the scorecard is active' },
            updaterUserId: {
              type: 'number',
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
            reviewMethod: {
              type: 'string',
              description: 'Review method configured for the scorecard',
            },
            questions: {
              type: 'array',
              description: 'List of questions in the scorecard',
              items: {
                type: 'object',
                properties: {
                  questionId: { type: 'number', description: 'Unique identifier for the question' },
                  questionRevisionId: {
                    type: 'number',
                    description: 'Identifier for the specific revision of the question',
                  },
                  questionText: { type: 'string', description: 'The text content of the question' },
                  isOverall: {
                    type: 'boolean',
                    description: 'Whether this is the primary overall question',
                  },
                  questionType: {
                    type: 'string',
                    description: 'The type of the question (e.g. range or select)',
                  },
                  answerGuide: {
                    type: 'string',
                    description: 'Guidance text describing how to answer the question',
                  },
                  minRange: {
                    type: 'number',
                    description: 'Minimum score for range-type questions',
                  },
                  maxRange: {
                    type: 'number',
                    description: 'Maximum score for range-type questions',
                  },
                  answerOptions: {
                    type: 'array',
                    description: 'Selectable options for select-type questions',
                    items: {
                      type: 'object',
                      properties: {
                        id: { type: 'number', description: 'Identifier of the option' },
                        text: { type: 'string', description: 'Display text of the option' },
                      },
                    },
                  },
                },
              },
            },
          },
        },
      },
    },
  }
