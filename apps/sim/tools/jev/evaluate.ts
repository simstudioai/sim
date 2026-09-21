import {
  buildJevBody,
  JEV_COMMON_PARAMS,
  JEV_REQUEST,
  parseJevQuestions,
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
    body: (params) => buildJevBody(params, params.questions),
  },
  transformResponse: async (response, params) => {
    const { model, usage, answers } = await parseJevResponse(response)
    if (!params) throw new Error('Jev batch response validation requires request parameters')
    const questions = parseJevQuestions(params.questions)
    if (
      Object.keys(answers).length !== Object.keys(questions).length ||
      Object.entries(questions).some(
        ([id, question]) => !Object.hasOwn(answers, id) || answers[id].type !== question.type
      )
    ) {
      throw new Error(
        'TypeSafe returned Jev answers that do not match the requested question IDs and types'
      )
    }
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
