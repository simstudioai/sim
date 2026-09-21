import {
  buildJevBody,
  JEV_COMMON_PARAMS,
  JEV_INSTRUCTIONS_PARAM,
  JEV_REQUEST,
  parseJevJson,
  parseJevResponse,
} from '@/tools/jev/shared'
import type { JevNoulParams, JevNoulResponse } from '@/tools/jev/types'
import type { ToolConfig } from '@/tools/types'

export const jevNoulTool: ToolConfig<JevNoulParams, JevNoulResponse> = {
  id: 'jev_noul',
  name: 'Jev Noul',
  description:
    'Evaluate a yes/no question with Jev and return the probability that the answer is yes.',
  version: '1.0.0',
  params: {
    ...JEV_COMMON_PARAMS,
    instructions: JEV_INSTRUCTIONS_PARAM,
    criteria: {
      type: 'json',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Optional object with true and false descriptions defining what yes and no mean.',
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
          type: 'noul',
          instructions: params.instructions,
          ...(params.criteria != null && params.criteria !== ''
            ? { criteria: parseJevJson(params.criteria, 'criteria') }
            : {}),
        },
      }),
  },
  transformResponse: async (response) => {
    const { model, usage, answers } = await parseJevResponse(response)
    const answer = answers.result
    if (answer?.type !== 'noul') throw new Error('TypeSafe returned no Noul answer')
    return { success: true, output: { model, usage, noul: answer.noul } }
  },
  outputs: {
    noul: { type: 'number', description: 'Probability of yes, from 0 (no) to 1 (yes)' },
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
