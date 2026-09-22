import {
  buildJevBody,
  JEV_COMMON_PARAMS,
  JEV_INSTRUCTIONS_PARAM,
  JEV_REQUEST,
  parseJevJson,
  parseJevResponse,
} from '@/tools/jev/shared'
import type { JevScoreParams, JevScoreResponse } from '@/tools/jev/types'
import type { ToolConfig } from '@/tools/types'

export const jevScoreTool: ToolConfig<JevScoreParams, JevScoreResponse> = {
  id: 'jev_score',
  name: 'Jev Score',
  description:
    'Score content against an ordered rubric with Jev, including probabilities and confidence.',
  version: '1.0.0',
  params: {
    ...JEV_COMMON_PARAMS,
    instructions: JEV_INSTRUCTIONS_PARAM,
    criteria: {
      type: 'array',
      required: true,
      visibility: 'user-or-llm',
      description: 'Ordered array of 2–10 rubric descriptions, from lowest to highest score.',
      minItems: 2,
      maxItems: 10,
      items: {
        anyOf: [
          { type: 'string' },
          { type: 'object', additionalProperties: true },
          { type: 'array', items: {} },
        ],
      },
    },
  },
  request: {
    ...JEV_REQUEST,
    modelInput: {
      mode: 'project',
      select: (params) => ({
        state: params.state,
        instructions: params.instructions,
        criteria: params.criteria,
      }),
    },
    body: (params) =>
      buildJevBody(params, {
        result: {
          type: 'score',
          instructions: params.instructions,
          criteria: parseJevJson(params.criteria, 'criteria'),
        },
      }),
  },
  transformResponse: async (response) => {
    const { model, usage, answers } = await parseJevResponse(response)
    const answer = answers.result
    if (answer?.type !== 'score') throw new Error('TypeSafe returned no Score answer')
    return {
      success: true,
      output: {
        model,
        usage,
        score: answer.score,
        legend: answer.legend,
        probabilities: answer.probabilities,
        confidence: answer.confidence,
      },
    }
  },
  outputs: {
    score: { type: 'number', description: 'Probability-weighted, zero-based rubric score' },
    legend: { type: 'json', description: 'Rubric descriptions keyed by level number' },
    probabilities: { type: 'json', description: 'Probability of each option or rubric level' },
    confidence: { type: 'number', description: 'Confidence in the answer, from 0 to 1' },
    model: { type: 'string', description: 'Versioned model ID used for evaluation' },
    usage: {
      type: 'object',
      description: 'Token usage reported by TypeSafe',
      properties: {
        input_tokens: { type: 'number', description: 'Input tokens consumed' },
        output_tokens: {
          type: 'number',
          description: 'Output tokens produced (not billed by TypeSafe)',
        },
      },
    },
  },
}
