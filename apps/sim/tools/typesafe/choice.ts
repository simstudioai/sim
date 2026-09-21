import type { ToolConfig } from '@/tools/types'
import { selectTypeSafeModelInput } from '@/tools/typesafe/model-input'
import type { TypeSafeChoiceParams, TypeSafeChoiceResponse } from '@/tools/typesafe/types'
import {
  buildTypeSafeQuestion,
  buildTypeSafeRequest,
  readTypeSafeResponse,
} from '@/tools/typesafe/utils'

export const typesafeChoiceTool: ToolConfig<TypeSafeChoiceParams, TypeSafeChoiceResponse> = {
  id: 'typesafe_choice',
  name: 'TypeSafe Choose an Option',
  description: 'Choose one named option with TypeSafe Jev and return its probability distribution.',
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
      type: 'json',
      required: true,
      visibility: 'user-or-llm',
      description:
        'Object mapping 1–255 option names to text, structured, or null descriptions. Example: {"billing":"Invoices and payments","technical":"Product problems"}',
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
        result: buildTypeSafeQuestion('choice', params.instructions, params.criteria),
      }),
    modelInput: { mode: 'project', select: selectTypeSafeModelInput },
    retry: { enabled: true, maxRetries: 2, initialDelayMs: 500, maxDelayMs: 5000 },
  },
  transformResponse: async (response) => {
    const data = await readTypeSafeResponse(response, { result: { type: 'choice' } })
    const answer = data.answers.result
    if (answer.type !== 'choice') throw new Error('TypeSafe returned an unexpected answer type')
    return {
      success: true,
      output: {
        choice: answer.choice,
        probabilities: answer.probabilities,
        confidence: answer.confidence,
        model: data.model,
        usage: data.usage,
      },
    }
  },
  outputs: {
    choice: { type: 'string', description: 'Selected option name' },
    probabilities: {
      type: 'json',
      description:
        'Dynamic map of option names to probabilities from 0 to 1, including zero values',
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
