import { normalizeQuestion, unwrapSingle } from '@/tools/jotform/normalize'
import type { JotformGetQuestionParams, JotformQuestionResponse } from '@/tools/jotform/types'
import {
  buildJotformHeaders,
  buildJotformUrl,
  parseJotformResponse,
  requireValue,
} from '@/tools/jotform/utils'
import type { ToolConfig } from '@/tools/types'

export const getQuestionTool: ToolConfig<JotformGetQuestionParams, JotformQuestionResponse> = {
  id: 'jotform_get_question',
  name: 'Jotform Get Question',
  description:
    'Get every property of a single form question, including its validation rules and field-specific settings.',
  version: '1.0.0',

  params: {
    apiKey: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'Jotform API key',
    },
    region: {
      type: 'string',
      required: false,
      visibility: 'user-only',
      description:
        'Jotform data residency region the API key belongs to: "us" (default), "eu", or "hipaa"',
    },
    formId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'ID of the form the question belongs to',
    },
    questionId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Question ID, available from the List Questions operation',
    },
  },

  request: {
    url: (params) =>
      buildJotformUrl(
        params,
        `form/${encodeURIComponent(requireValue(params.formId, 'formId'))}/question/${encodeURIComponent(
          requireValue(params.questionId, 'questionId')
        )}`
      ).toString(),
    method: 'GET',
    headers: (params) => buildJotformHeaders(params.apiKey),
  },

  transformResponse: async (response: Response) => {
    const envelope = await parseJotformResponse(response, 'Jotform Get Question')
    const raw = unwrapSingle(envelope.content)
    if (!raw) throw new Error('Jotform Get Question returned no question.')

    return {
      success: true,
      output: { question: normalizeQuestion(raw) },
    }
  },

  outputs: {
    question: {
      type: 'object',
      description:
        'The requested question. Also carries the type-specific properties Jotform stores for that field.',
      properties: {
        qid: { type: 'string', description: 'Question ID' },
        name: { type: 'string', description: 'Slug of the question label' },
        order: { type: 'string', description: 'Position of the question on the form' },
        text: { type: 'string', description: 'Question label' },
        type: { type: 'string', description: 'Field type, e.g. control_head or control_textbox' },
        required: { type: 'string', description: 'Yes when the question is required' },
      },
    },
  },
}
