import {
  buildJevBody,
  JEV_COMMON_PARAMS,
  JEV_REQUEST,
  parseJevJson,
  parseJevResponse,
} from '@/tools/jev/shared'
import type { JevEvaluateParams, JevEvaluateResponse } from '@/tools/jev/types'
import type { ToolConfig } from '@/tools/types'

export const jevEvaluateTool: ToolConfig<JevEvaluateParams, JevEvaluateResponse> = {
  id: 'jev_evaluate',
  name: 'Jev Evaluate',
  description:
    'Evaluate multiple Choice, Score, and Noul questions against shared state in one Jev request.',
  version: '1.0.0',
  params: {
    ...JEV_COMMON_PARAMS,
    questions: {
      type: 'json',
      required: true,
      visibility: 'user-or-llm',
      description:
        'Map of question IDs to {type, instructions, criteria}. Types: choice (option map), score (2–10 ordered levels), noul (optional true/false descriptions). Answers use the same IDs.',
    },
  },
  request: {
    ...JEV_REQUEST,
    modelInput: {
      mode: 'project',
      select: (params) => ({ state: params.state, questions: params.questions }),
    },
    body: (params) => buildJevBody(params, parseJevJson(params.questions, 'questions')),
  },
  transformResponse: async (response) => {
    const { model, usage, answers } = await parseJevResponse(response)
    return { success: true, output: { model, usage, answers } }
  },
  outputs: {
    answers: {
      type: 'json',
      description:
        'Answers keyed by question ID. Choice: type, choice, probabilities, confidence. Score: type, score, legend, probabilities, confidence. Noul: type, noul.',
    },
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
