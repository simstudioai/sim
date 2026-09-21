import {
  buildJevBody,
  JEV_COMMON_PARAMS,
  JEV_INSTRUCTIONS_PARAM,
  JEV_REQUEST,
  parseJevJson,
  parseJevResponse,
} from '@/tools/jev/shared'
import type { JevChoiceParams, JevChoiceResponse } from '@/tools/jev/types'
import type { ToolConfig } from '@/tools/types'

export const jevChoiceTool: ToolConfig<JevChoiceParams, JevChoiceResponse> = {
  id: 'jev_choice',
  name: 'Jev Choice',
  description: 'Choose an option with Jev and return its probability distribution and confidence.',
  version: '1.0.0',
  params: {
    ...JEV_COMMON_PARAMS,
    instructions: JEV_INSTRUCTIONS_PARAM,
    criteria: {
      type: 'json',
      required: true,
      visibility: 'user-or-llm',
      description: 'Map of 1–255 option names to descriptions (text, object, array, or null).',
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
          type: 'choice',
          instructions: params.instructions,
          criteria: parseJevJson(params.criteria, 'criteria'),
        },
      }),
  },
  transformResponse: async (response) => {
    const { model, usage, answers } = await parseJevResponse(response)
    const answer = answers.result
    if (answer?.type !== 'choice') throw new Error('TypeSafe returned no Choice answer')
    return {
      success: true,
      output: {
        model,
        usage,
        choice: answer.choice,
        probabilities: answer.probabilities,
        confidence: answer.confidence,
      },
    }
  },
  outputs: {
    choice: { type: 'string', description: 'Selected option' },
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
