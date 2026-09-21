import type { ToolConfig } from '@/tools/types'
import {
  applyTypeSafeEvaluateModelInput,
  selectTypeSafeEvaluateModelInput,
} from '@/tools/typesafe/model-input'
import type { TypeSafeEvaluateParams, TypeSafeEvaluateResponse } from '@/tools/typesafe/types'
import {
  buildTypeSafeRequest,
  normalizeTypeSafeQuestions,
  readTypeSafeResponse,
} from '@/tools/typesafe/utils'

export const typesafeEvaluateTool: ToolConfig<TypeSafeEvaluateParams, TypeSafeEvaluateResponse> = {
  id: 'typesafe_evaluate',
  name: 'TypeSafe Evaluate Questions',
  description:
    'Evaluate independent named Choice, Score, and Noul questions against shared state in one TypeSafe Jev request.',
  version: '1.0.0',
  params: {
    state: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description:
        'Shared input to evaluate: plain text or a JSON-encoded object or array. Resolved workflow objects and arrays are also supported.',
    },

    questions: {
      type: 'json',
      required: true,
      visibility: 'user-or-llm',
      description:
        'Nonempty object of named questions, each with type choice, score, or noul. Instructions are optional text, structured values, or null. Choice requires a 1–255 option criteria object; Score requires a 2–10 item criteria array; Noul accepts optional true/false criteria. Example: {"supported":{"type":"noul","instructions":"Does the source support the claim?"}}',
    },
    apiKey: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'TypeSafe API key',
    },
    model: {
      type: 'string',
      required: false,
      visibility: 'user-only',
      default: 'jev-latest',
      description:
        'Model ID or alias, such as jev-latest, jev-preview, or jev-1.13.0. Custom IDs are supported.',
    },
  },
  request: {
    url: 'https://api.typesafe.ai/v1/systemone',
    method: 'POST',
    headers: (params) => ({
      Authorization: `Bearer ${params.apiKey}`,
      'Content-Type': 'application/json',
    }),
    body: (params) => buildTypeSafeRequest(params, normalizeTypeSafeQuestions(params.questions)),
    modelInput: {
      mode: 'project',
      select: selectTypeSafeEvaluateModelInput,
      applyProjected: applyTypeSafeEvaluateModelInput,
    },
    retry: { enabled: true, maxRetries: 2, initialDelayMs: 500, maxDelayMs: 5000 },
  },
  transformResponse: async (response, params, context) => {
    const output = await readTypeSafeResponse(
      response,
      context?.requestBody === undefined && params
        ? normalizeTypeSafeQuestions(params.questions)
        : undefined,
      context
    )
    return { success: true, output }
  },
  outputs: {
    answers: {
      type: 'json',
      description:
        'Dynamic map keyed by your question IDs. Choice answers contain type, choice, probabilities, confidence; Score answers contain type, score, legend, probabilities, confidence; Noul answers contain type and noul.',
    },
    model: { type: 'string', description: 'Resolved model ID returned by TypeSafe' },
    usage: {
      type: 'object',
      description: 'Token usage for the entire request',
      properties: {
        input_tokens: { type: 'number', description: 'Number of input tokens used' },
        output_tokens: { type: 'number', description: 'Number of output tokens used' },
      },
    },
  },
}
