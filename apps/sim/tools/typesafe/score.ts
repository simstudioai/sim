import type { ToolConfig } from '@/tools/types'
import { selectTypeSafeModelInput } from '@/tools/typesafe/model-input'
import type { TypeSafeScoreParams, TypeSafeScoreResponse } from '@/tools/typesafe/types'
import {
  buildTypeSafeQuestion,
  buildTypeSafeRequest,
  readTypeSafeResponse,
} from '@/tools/typesafe/utils'

export const typesafeScoreTool: ToolConfig<TypeSafeScoreParams, TypeSafeScoreResponse> = {
  id: 'typesafe_score',
  name: 'TypeSafe Assign a Score',
  description:
    'Score input against an ordered rubric using TypeSafe Jev, preserving fractional scores.',
  version: '1.0.0',
  params: {
    state: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description:
        'Shared input to evaluate: plain text or a JSON-encoded object or array. Resolved workflow objects and arrays are also supported.',
    },
    instructions: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description:
        'Question or evaluation instructions. Provide text or a JSON-encoded object or array.',
    },
    criteria: {
      type: 'array',
      required: true,
      visibility: 'user-or-llm',
      minItems: 2,
      maxItems: 10,
      items: {
        anyOf: [{ type: 'string' }, { type: 'object' }, { type: 'array' }, { type: 'null' }],
      },
      description:
        'Ordered array of 2–10 rubric descriptions, indexed from zero. Descriptions may be text, structured, or null. Example: ["Routine","Time sensitive","Service unavailable"]',
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
    body: (params) =>
      buildTypeSafeRequest(params, {
        result: buildTypeSafeQuestion('score', params.instructions, params.criteria),
      }),
    modelInput: { mode: 'project', select: selectTypeSafeModelInput },
    retry: { enabled: true, maxRetries: 2, initialDelayMs: 500, maxDelayMs: 5000 },
  },
  transformResponse: async (response) => {
    const data = await readTypeSafeResponse(response, { result: { type: 'score' } })
    const answer = data.answers.result
    if (answer.type !== 'score') throw new Error('TypeSafe returned an unexpected answer type')
    return {
      success: true,
      output: {
        score: answer.score,
        legend: answer.legend,
        probabilities: answer.probabilities,
        confidence: answer.confidence,
        model: data.model,
        usage: data.usage,
      },
    }
  },
  outputs: {
    score: {
      type: 'number',
      description: 'Expected score on the zero-indexed rubric; may be fractional',
    },
    legend: {
      type: 'json',
      description:
        'Dynamic map of score indices to the original text, structured, or null rubric descriptions',
    },
    probabilities: {
      type: 'json',
      description: 'Dynamic map of score indices to probabilities from 0 to 1',
    },
    confidence: {
      type: 'number',
      description: 'Distribution-based confidence from 0 to 1; not a guarantee of correctness',
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
